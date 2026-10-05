// Builds the iCalendar (.ics) feed the iPhone subscribes to. Server-only — the
// route handlers in app/api/calendar/ are the only things that should use this.
//
// What goes in the calendar:
//   - Job start dates          (accepted quotes with a start date)
//   - Site visits              (leads with a visit date, optionally a time)
//   - Quote follow-ups         (sent quotes, a few days after they were made)
//   - Invoice due dates        (unpaid invoices)
import crypto from "node:crypto";
import { gstBreakdown, itemsTotal, money } from "./logic";

const TZID = "Australia/Brisbane"; // QLD doesn't observe daylight saving
const FOLLOW_UP_DAYS = 3;
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

const isIsoDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
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

const joinLines = (parts) => parts.filter(Boolean).join("\n");
const place = (o) => [o.address, o.suburb].filter(Boolean).join(", ");
const clip = (s, n = 300) => (s && s.length > n ? `${s.slice(0, n)}…` : s || "");
const incGst = (items) => money(gstBreakdown(itemsTotal(items)).total);

export function buildCalendarFeed({ leads = [], quotes = [], invoices = [] }) {
  const events = [];

  for (const q of quotes) {
    // Accepted job with a start date -> all-day event, nudged the afternoon before and early on the day.
    if (q.status === "Accepted" && isIsoDate(q.startDate)) {
      events.push(vevent({
        uid: `job-${q.id}`,
        summary: `Job start – ${q.clientName || "Client"}${q.jobType ? ` (${q.jobType})` : ""}`,
        date: q.startDate,
        location: place(q),
        description: joinLines([
          q.clientPhone && `Phone: ${q.clientPhone}`,
          q.docNumber && `Quote ${q.docNumber} — ${incGst(q.items)} inc. GST`,
          q.notes && clip(q.notes),
        ]),
        alarms: [
          { trigger: "-PT9H", text: "Job starts tomorrow" },
          { trigger: "PT6H", text: "Job starts today" },
        ],
        busy: true,
      }));
    }
    // Sent quote with no answer yet -> follow-up reminder a few days on.
    if (q.status === "Sent" && isIsoDate(q.date)) {
      events.push(vevent({
        uid: `followup-${q.id}`,
        summary: `Follow up quote – ${q.clientName || "Client"}`,
        date: addDaysIso(q.date, FOLLOW_UP_DAYS),
        location: place(q),
        description: joinLines([
          q.clientPhone && `Phone: ${q.clientPhone}`,
          q.docNumber && `Quote ${q.docNumber} — ${incGst(q.items)} inc. GST`,
        ]),
        alarms: [{ trigger: "PT9H", text: "Follow up on this quote" }],
      }));
    }
  }

  for (const l of leads) {
    if (l.status === "Lost" || !isIsoDate(l.visitDate)) continue;
    events.push(vevent({
      uid: `visit-${l.id}`,
      summary: `Site visit – ${l.name || "Lead"}${l.jobType ? ` (${l.jobType})` : ""}`,
      date: l.visitDate,
      time: isTime(l.visitTime) ? l.visitTime : null,
      location: l.address || "",
      description: joinLines([l.phone && `Phone: ${l.phone}`, l.notes && clip(l.notes)]),
      alarms: isTime(l.visitTime)
        ? [{ trigger: "-P1D", text: "Site visit tomorrow" }, { trigger: "-PT1H", text: "Site visit in 1 hour" }]
        : [{ trigger: "-PT9H", text: "Site visit tomorrow" }, { trigger: "PT7H", text: "Site visit today" }],
      busy: true,
    }));
  }

  for (const i of invoices) {
    if (i.status === "Paid" || !isIsoDate(i.dueDate)) continue;
    events.push(vevent({
      uid: `invoice-${i.id}`,
      summary: `Invoice due – ${i.clientName || "Client"}${i.docNumber ? ` ${i.docNumber}` : ""}`,
      date: i.dueDate,
      location: place(i),
      description: `${incGst(i.items)} inc. GST`,
      alarms: [{ trigger: "PT9H", text: "Invoice due today — chase payment" }],
    }));
  }

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
