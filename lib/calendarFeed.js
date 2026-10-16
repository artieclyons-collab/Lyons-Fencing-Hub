// Builds the iCalendar (.ics) feed the iPhone subscribes to. Server-only — the
// route handlers in app/api/calendar/ are the only things that should use this.
//
// What goes in the calendar (decided in lib/schedule.js, shared with the Board):
//   - Job start dates          (accepted quotes with a start date)
//   - Site visits              (leads with a visit date, optionally a time)
//   - Quote follow-ups         (sent quotes, a few days after they were made)
//   - Invoice due dates        (unpaid invoices)
import crypto from "node:crypto";
import { scheduleEvents } from "./schedule";

const TZID = "Australia/Brisbane"; // QLD doesn't observe daylight saving
const SITE_VISIT_MINUTES = 60;

// The feed URL is private, so it carries a token derived from the server-only
// service key — nothing extra to configure, and it can't be worked back to the key.
export function calendarToken() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update("lyons-calendar-feed-v1").digest("base64url");
}

export function tokenMatches(given) {
  const expected = calendarToken();
  if (!expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- iCalendar text helpers ----------
const escapeText = (s) =>
  String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Lines longer than 75 bytes must be folded (without splitting a multi-byte character).
function fold(line) {
  const out = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > limit) {
      out.push(cur);
      cur = ch;
      bytes = b;
      limit = 74; // continuation lines start with a space
    } else {
      cur += ch;
      bytes += b;
    }
  }
  out.push(cur);
  return out.join("\r\n ");
}

const compactDate = (iso) => iso.replace(/-/g, "");

function addDaysIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function localDateTime(iso, hhmm, addMinutes = 0) {
  const [y, mo, d] = iso.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi + addMinutes));
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}T${p(dt.getUTCHours())}${p(dt.getUTCMinutes())}00`;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function alarm(trigger, text) {
  return ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(text)}`, `TRIGGER:${trigger}`, "END:VALARM"];
}

function vevent({ uid, summary, date, time, location, description, alarms, busy }) {
  const lines = ["BEGIN:VEVENT", `UID:${uid}@lyons-fencing-hub`, `DTSTAMP:${stamp()}`];
  if (time) {
    lines.push(`DTSTART;TZID=${TZID}:${localDateTime(date, time)}`);
    lines.push(`DTEND;TZID=${TZID}:${localDateTime(date, time, SITE_VISIT_MINUTES)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${compactDate(date)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(addDaysIso(date, 1))}`);
  }
  lines.push(`SUMMARY:${escapeText(summary)}`);
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (!busy) lines.push("TRANSP:TRANSPARENT"); // reminders shouldn't block the day out as "busy"
  for (const a of alarms) lines.push(...alarm(a.trigger, a.text));
  lines.push("END:VEVENT");
  return lines;
}

// Reminders per kind of event. Triggers are relative to the event's start
// (an all-day event starts at midnight, so PT9H = 9am that day, -PT9H = 3pm the day before).
const ALARMS = {
  job: [{ trigger: "-PT9H", text: "Job starts tomorrow" }, { trigger: "PT6H", text: "Job starts today" }],
  visitTimed: [{ trigger: "-P1D", text: "Site visit tomorrow" }, { trigger: "-PT1H", text: "Site visit in 1 hour" }],
  visitAllDay: [{ trigger: "-PT9H", text: "Site visit tomorrow" }, { trigger: "PT7H", text: "Site visit today" }],
  followup: [{ trigger: "PT9H", text: "Follow up on this quote" }],
  invoice: [{ trigger: "PT9H", text: "Invoice due today — chase payment" }],
};

const alarmsFor = (e) => (e.kind === "visit" ? ALARMS[e.time ? "visitTimed" : "visitAllDay"] : ALARMS[e.kind]);

export function buildCalendarFeed({ leads = [], quotes = [], invoices = [] }) {
  const events = scheduleEvents({ leads, quotes, invoices }).map((e) =>
    vevent({
      uid: e.uid,
      summary: e.summary,
      date: e.date,
      time: e.time,
      location: e.location,
      description: e.lines.filter(Boolean).join("\n"),
      alarms: alarmsFor(e),
      busy: e.kind === "job" || e.kind === "visit",
    })
  );

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lyons Fencing & Services//Business Hub//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Lyons Fencing Hub",
    `X-WR-TIMEZONE:${TZID}`,
    "X-PUBLISHED-TTL:PT15M",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "BEGIN:VTIMEZONE",
    `TZID:${TZID}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+1000",
    "TZOFFSETTO:+1000",
    "TZNAME:AEST",
    "END:STANDARD",
    "END:VTIMEZONE",
    ...events.flat(),
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
