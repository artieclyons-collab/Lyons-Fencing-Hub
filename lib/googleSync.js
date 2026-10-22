// Keeps the hub and a Google Calendar in step, both ways. Server-only, and deliberately free of database/network
// code so it can be tested on its own: it works out WHAT to change; the route does the changing.
//
// How it stays two-way without a database of its own: every event written to Google carries (as private properties)
// the date/time the hub had when it was last written (hubDate / hubTime) and a fingerprint of its text (hubSig).
//   - Google's date differs from what we wrote, hub unchanged  -> you moved it on your phone: change the hub.
//   - Hub's date differs from what we wrote                    -> you moved it in the hub: change Google (hub wins a tie).
//   - Event missing in Google                                  -> create it.
//   - Event "cancelled" in Google (deleted on the phone)       -> leave it deleted; never re-create it.
//   - Hub event gone (lead lost, job removed)                  -> delete it from Google.
import crypto from "node:crypto";

export const TZ = "Australia/Brisbane"; // QLD has no daylight saving: always UTC+10
const OFFSET_HOURS = 10;
const VISIT_MINUTES = 60;
const MORNING = "09:00"; // follow-ups and invoices sit at 9am so they can have a reminder at the time

export const eventId = (uid) => `lf${crypto.createHash("sha1").update(String(uid)).digest("hex")}`; // Google ids: a-v and 0-9

const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const clockPlus = (date, hhmm, minutes) => {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi + minutes));
  return `${dt.toISOString().slice(0, 10)}T${dt.toISOString().slice(11, 16)}:00`;
};

// A Google start ({ date } or { dateTime }) as hub-style { date, time } in Brisbane time, whatever zone the phone used.
export function readStart(g) {
  const s = g?.start || {};
  if (s.date) return { date: s.date, time: "" };
  if (!s.dateTime) return { date: "", time: "" };
  // No zone on the string means it is already Brisbane time (as written by us); read it as written, whatever zone this server is in.
  if (!/(?:[zZ]|[+-]dd:?dd)$/.test(s.dateTime)) return { date: s.dateTime.slice(0, 10), time: s.dateTime.slice(11, 16) };
  const shifted = new Date(Date.parse(s.dateTime) + OFFSET_HOURS * 3600000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

const sig = (e) => crypto.createHash("md5").update(JSON.stringify([e.summary, e.location || "", (e.lines || []).filter(Boolean), e.date, e.time || ""])).digest("hex");

// Reminders (minutes before the start). Google can't remind "at 7am on the day" for an all-day entry, so those
// remind at 3pm the day before; the 9am entries and timed visits remind properly.
function reminders(e) {
  if (e.kind === "visit" && e.time) return [{ method: "popup", minutes: 1440 }, { method: "popup", minutes: 60 }];
  if (e.kind === "visit") return [{ method: "popup", minutes: 540 }];
  if (e.kind === "job") return e.dayIndex > 0 ? [] : [{ method: "popup", minutes: 540 }];
  return [{ method: "popup", minutes: 0 }]; // follow-up / invoice due, at 9am
}

// The Google event for a hub event. null fields clear whatever was there (a visit gaining or losing a time).
export function toGoogleEvent(e) {
  const timed = !!e.time || e.kind === "followup" || e.kind === "invoice";
  const startTime = e.time || MORNING;
  const minutes = e.kind === "visit" ? VISIT_MINUTES : 15;
  const description = [...(e.lines || []).filter(Boolean), "", "Managed by the Lyons Fencing Hub — move it here or in the hub and the other follows."].join("\n");
  return {
    summary: e.summary,
    location: e.location || "",
    description,
    start: timed ? { dateTime: `${e.date}T${startTime}:00`, timeZone: TZ, date: null } : { date: e.date, dateTime: null, timeZone: null },
    end: timed ? { dateTime: clockPlus(e.date, startTime, minutes), timeZone: TZ, date: null } : { date: addDays(e.date, 1), dateTime: null, timeZone: null },
    transparency: e.kind === "job" || e.kind === "visit" ? "opaque" : "transparent",
    reminders: { useDefault: false, overrides: reminders(e) },
    extendedProperties: { private: { hubManaged: "1", hubUid: e.uid, hubDate: e.date, hubTime: e.time || "", hubSig: sig(e) } },
  };
}

// null-valued keys are only meant for updates; an insert must leave them out.
const forInsert = (body) => {
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null).map(([k, v]) => [k, v && typeof v === "object" && !Array.isArray(v) ? clean(v) : v]));
  return clean(body);
};

function hubUpdateFor(e, now, pushed) {
  const { table, id, field, timeField } = e.ref;
  let value = now.date;
  // Any day of a multi-day job moves the whole job: shift its start date by however far that day was moved.
  if (e.kind === "job" && e.dayIndex > 0) value = addDays(e.editDate || e.date, daysBetween(pushed.hubDate, now.date));
  const fields = { [field]: value };
  if (timeField) fields[timeField] = now.time || "";
  return { table, id, fields, uid: e.uid, name: e.name };
}

// desired: the hub's events (from scheduleEvents). google: events listed from the calendar. today: ISO date.
export function reconcile({ desired, google, today }) {
  const keep = addDays(today, -1); // yesterday's and older are history: never touched
  const byId = new Map(google.map((g) => [g.id, g]));
  const out = { insert: [], patch: [], remove: [], hubUpdates: [], deletedOnPhone: 0, unchanged: 0 };
  const wanted = new Set();
  const claimed = new Set(); // record fields already being changed in the hub this round

  for (const e of desired) {
    if (e.date < keep) continue;
    const id = eventId(e.uid);
    wanted.add(id);
    const g = byId.get(id);
    const body = toGoogleEvent(e);

    if (!g) { out.insert.push({ id, body: forInsert({ ...body, id }) }); continue; }
    if (g.status === "cancelled") { out.deletedOnPhone++; continue; }

    const pushed = g.extendedProperties?.private || {};
    const now = readStart(g);
    const timeMatters = !!e.ref?.timeField;
    const hubChanged = e.date !== pushed.hubDate || (timeMatters && (e.time || "") !== (pushed.hubTime || ""));
    const movedOnPhone = now.date !== pushed.hubDate || (timeMatters && now.time !== (pushed.hubTime || ""));

    if (movedOnPhone && !hubChanged && e.ref) {
      const u = hubUpdateFor(e, now, pushed);
      const key = `${u.table}:${u.id}`;
      if (!claimed.has(key)) {
        claimed.add(key);
        out.hubUpdates.push(u);
        // Remember what the hub will now hold, so the next round sees nothing to do.
        const after = { ...e, date: now.date, time: timeMatters ? now.time : e.time };
        out.patch.push({ id, body: { extendedProperties: { private: { ...body.extendedProperties.private, hubDate: after.date, hubTime: after.time || "", hubSig: sig(after) } } } });
        continue;
      }
    }
    if (hubChanged || movedOnPhone || pushed.hubSig !== body.extendedProperties.private.hubSig) out.patch.push({ id, body });
    else out.unchanged++;
  }

  for (const g of google) {
    if (g.status === "cancelled" || g.extendedProperties?.private?.hubManaged !== "1" || wanted.has(g.id)) continue;
    if (readStart(g).date >= keep) out.remove.push(g.id); // no longer in the hub (lead lost, job removed, date past the window…)
  }
  return out;
}

// Runs one round: read the calendar, work out the changes, apply them. The database work is injected.
//   desired:        hub events, today: ISO date, client: googleCalendar client, applyHubUpdate: async ({table,id,fields}) => void
export async function runSync({ desired, today, client, applyHubUpdate }) {
  const google = await client.listManaged(`${addDays(today, -2)}T00:00:00Z`);
  const plan = reconcile({ desired, google, today });

  // A bad read of the hub (an empty list) must never wipe the calendar: refuse a big clear-out.
  const live = google.filter((g) => g.status !== "cancelled").length;
  let heldBack = 0;
  if (plan.remove.length > 20 && plan.remove.length > live * 0.5) { heldBack = plan.remove.length; plan.remove = []; }

  const result = { created: 0, updated: 0, removed: 0, pulled: 0, deletedOnPhone: plan.deletedOnPhone, heldBack, errors: [] };

  // 1) what you changed on the phone goes into the hub
  for (const u of plan.hubUpdates) {
    try {
      await applyHubUpdate(u);
      result.pulled++;
    } catch (err) {
      result.errors.push(`Couldn't update ${u.name || u.id} in the hub: ${err.message}`);
      // leave the calendar entry alone so it's tried again next round
      plan.patch = plan.patch.filter((p) => p.id !== eventId(u.uid));
    }
  }

  // 2) what changed in the hub goes to the calendar (a handful at a time, to stay quick and gentle)
  const jobs = [
    ...plan.insert.map((x) => () => client.insert(x.body).then(() => { result.created++; })),
    ...plan.patch.map((x) => () => client.patch(x.id, x.body).then(() => { result.updated++; })),
    ...plan.remove.map((id) => () => client.remove(id).then(() => { result.removed++; })),
  ];
  for (let i = 0; i < jobs.length; i += 5) {
    const settled = await Promise.allSettled(jobs.slice(i, i + 5).map((f) => f()));
    for (const s of settled) if (s.status === "rejected") result.errors.push(s.reason?.message || String(s.reason));
  }
  return result;
}
