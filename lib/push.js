// Phone alerts (web push), server side. Subscriptions are rows in the expenses table (category "System", id "push-…"), so no database
// change is needed. Needs VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (and NEXT_PUBLIC_VAPID_PUBLIC_KEY for the browser) in the environment.
import { hasQuote } from "./leadQuotes";
import { dueTexts, DEFAULT_TEXTS } from "./dueTexts";

// web-push is a CommonJS package: load it when needed and take its default export if the bundler gives one.
let wp = null;
async function webpushLib() {
  if (!wp) { const m = await import("web-push"); wp = m.default || m; }
  return wp;
}

export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
const NUDGE_ID = "sys-nudge";

// Sends { title, body, tag?, url? } to every phone that turned alerts on. Dead subscriptions are removed. -> { sent, removed }
export async function sendPush(db, payload) {
  if (!pushConfigured() || !db) return { sent: 0, removed: 0 };
  const webpush = await webpushLib();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:lyonsfencingservices@gmail.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const { data } = await db.from("expenses").select("id,description").like("id", "push-%");
  let sent = 0;
  const dead = [];
  for (const row of data || []) {
    let sub;
    try { sub = JSON.parse(row.description); } catch { dead.push(row.id); continue; }
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(row.id);
      else console.log("push: a send failed —", String(e?.message || e).slice(0, 100));
    }
  }
  if (dead.length) await db.from("expenses").delete().in("id", dead);
  return { sent, removed: dead.length };
}

// One alert a day, from 8am (Brisbane), when there are follow-up texts to send: quote follow-ups, start-date texts, invoice chasers and
// review requests (the same list as "Texts to send" on the Board; new hipages leads are left out because they have their own alerts).
// It's sent once per day; the day it was last sent is kept in one small row. -> { sent, due }
const DIGEST_ID = "sys-digest";
const DIGEST_FROM_HOUR = 8;
const DIGEST_TO_HOUR = 17;
const PLURAL = { quote: ["quote follow-up", "quote follow-ups"], job: ["start-date text", "start-date texts"], invoice: ["invoice chaser", "invoice chasers"], review: ["review request", "review requests"], ask: ["question before a job", "questions before a job"] };

export async function dailyTextsDigest(db, nowDate = new Date()) {
  if (!pushConfigured() || !db) return { sent: 0, due: 0 };
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(nowDate).map((p) => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  if (hour < DIGEST_FROM_HOUR || hour >= DIGEST_TO_HOUR) return { sent: 0, due: 0 };

  const { data: stateRow } = await db.from("expenses").select("description").eq("id", DIGEST_ID).maybeSingle();
  let state = {};
  try { state = JSON.parse(stateRow?.description || "{}") || {}; } catch { state = {}; }
  if (state.day === day) return { sent: 0, due: 0 };

  const [{ data: leads }, { data: quotes }, { data: invoices }] = await Promise.all([db.from("leads").select("*"), db.from("quotes").select("*"), db.from("invoices").select("*")]);
  const due = dueTexts({ leads: leads || [], quotes: quotes || [], invoices: invoices || [] }, DEFAULT_TEXTS, day).filter((x) => x.kind !== "lead");
  if (due.length === 0) return { sent: 0, due: 0 };

  const counts = {};
  for (const x of due) counts[x.kind] = (counts[x.kind] || 0) + 1;
  const bits = Object.keys(PLURAL).filter((k) => counts[k]).map((k) => `${counts[k]} ${PLURAL[k][counts[k] === 1 ? 0 : 1]}`);
  // people, not texts: a client with three quotes out counts once in the headline
  const people = new Set(due.map((x) => String(x.who || "").trim().toLowerCase()));
  const res = await sendPush(db, { title: `${people.size} ${people.size === 1 ? "person" : "people"} to text today`, body: `${bits.join(", ")}. Open the hub and tap to send.`, tag: "texts-digest", url: "/" });
  if (res.sent > 0) await db.from("expenses").upsert({ id: DIGEST_ID, category: "System", description: JSON.stringify({ day, n: due.length }), amount: "0", date: day });
  return { sent: res.sent, due: due.length };
}

// A hipages lead that's still waiting for a first reply gets a reminder 10 minutes after the hub first saw it, then every 30 minutes,
// up to 4 times, and only while it's fresh (under 12 hours). What's been sent is kept in one small row.
export async function nudgeUnanswered(db) {
  if (!pushConfigured() || !db) return { nudged: 0 };
  const [{ data: leads }, { data: quotes }, { data: stateRow }] = await Promise.all([
    db.from("leads").select("id,name,phone,email,source,status,createdAt"),
    db.from("quotes").select("id,docNumber,clientName,clientPhone,clientEmail,status,address,suburb"),
    db.from("expenses").select("description").eq("id", NUDGE_ID).maybeSingle(),
  ]);
  let state = {};
  try { state = JSON.parse(stateRow?.description || "{}") || {}; } catch { state = {}; }
  const now = Date.now();
  // only leads from today or yesterday (Brisbane), so an old lead nobody ever replied to doesn't start buzzing
  const day = (offset) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date(now + offset * 86400000));
  const oldest = day(-1);
  const waiting = (leads || []).filter((l) => l.source === "hipages" && l.status === "New" && String(l.createdAt || "").slice(0, 10) >= oldest && !hasQuote(l, quotes || []));
  let nudged = 0;
  for (const l of waiting) {
    const s = (state[l.id] = state[l.id] || { first: now, last: 0, n: 0 });
    const mins = Math.round((now - s.first) / 60000);
    if (now - s.first > 12 * 3600000 || s.n >= 4) continue;
    if (mins < 10 || (s.last && now - s.last < 30 * 60000)) continue;
    await sendPush(db, { title: `Reply to ${l.name || "the new lead"} (hipages)`, body: `Waiting ${mins} min. The first text wins the job.`, tag: `lead-${l.id}`, url: "/" });
    s.last = now;
    s.n += 1;
    nudged++;
  }
  for (const id of Object.keys(state)) if (!waiting.some((l) => l.id === id) && now - state[id].first > 24 * 3600000) delete state[id];
  await db.from("expenses").upsert({ id: NUDGE_ID, category: "System", description: JSON.stringify(state), amount: "0", date: new Date().toISOString().slice(0, 10) });
  return { nudged };
}
