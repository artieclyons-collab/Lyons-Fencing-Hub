// Everything in the hub that has a date attached, in one place. The Board's
// "Coming up" list and the iPhone calendar feed (lib/calendarFeed.js) both read
// from this, so what you see on the Board is what lands in your calendar.
//
//   job       accepted quote with a start date
//   visit     lead with a site visit date (and optionally a time)
//   followup  sent quote, FOLLOW_UP_DAYS after it was made
//   invoice   unpaid invoice with a due date
import { gstBreakdown, itemsTotal, money } from "./logic";

export const FOLLOW_UP_DAYS = 3;

export const isIsoDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isTime = (s) => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);

export function addDaysIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const place = (o) => [o.address, o.suburb].filter(Boolean).join(", ");
const clip = (s, n = 300) => (s && s.length > n ? `${s.slice(0, n)}…` : s || "");
const inc = (items) => gstBreakdown(itemsTotal(items)).total;

// Returns events sorted by date then time. Each one has:
//   uid, kind, date, time (or null), name, label, subtitle (for the Board),
//   summary/location/lines (for the calendar), tab (where it lives in the hub),
//   ref (which record + field holds its date, or null if it can't be moved directly)
export function scheduleEvents({ leads = [], quotes = [], invoices = [] }) {
  const events = [];

  for (const q of quotes) {
    const total = money(inc(q.items));
    if (q.status === "Accepted" && isIsoDate(q.startDate)) {
      events.push({
        uid: `job-${q.id}`,
        kind: "job",
        ref: { table: "quotes", id: q.id, field: "startDate" },
        date: q.startDate,
        time: null,
        name: q.clientName || "Client",
        label: "Job start",
        subtitle: [q.jobType, q.suburb, `${total} inc. GST`].filter(Boolean).join(" · "),
        summary: `Job start – ${q.clientName || "Client"}${q.jobType ? ` (${q.jobType})` : ""}`,
        location: place(q),
        lines: [q.clientPhone && `Phone: ${q.clientPhone}`, q.docNumber && `Quote ${q.docNumber} — ${total} inc. GST`, q.notes && clip(q.notes)],
        tab: "quotes",
      });
    }
    if (q.status === "Sent" && isIsoDate(q.date)) {
      events.push({
        uid: `followup-${q.id}`,
        kind: "followup",
        ref: null, // worked out from the quote date, so it can't be moved on its own
        date: addDaysIso(q.date, FOLLOW_UP_DAYS),
        time: null,
        name: q.clientName || "Client",
        label: "Follow up quote",
        subtitle: [q.docNumber, `${total} inc. GST`].filter(Boolean).join(" · "),
        summary: `Follow up quote – ${q.clientName || "Client"}`,
        location: place(q),
        lines: [q.clientPhone && `Phone: ${q.clientPhone}`, q.docNumber && `Quote ${q.docNumber} — ${total} inc. GST`],
        tab: "quotes",
      });
    }
  }

  for (const l of leads) {
    if (l.status === "Lost" || !isIsoDate(l.visitDate)) continue;
    events.push({
      uid: `visit-${l.id}`,
      kind: "visit",
      ref: { table: "leads", id: l.id, field: "visitDate", timeField: "visitTime" },
      date: l.visitDate,
      time: isTime(l.visitTime) ? l.visitTime : null,
      name: l.name || "Lead",
      label: "Site visit",
      subtitle: [l.jobType, l.address].filter(Boolean).join(" · "),
      summary: `Site visit – ${l.name || "Lead"}${l.jobType ? ` (${l.jobType})` : ""}`,
      location: l.address || "",
      lines: [l.phone && `Phone: ${l.phone}`, l.notes && clip(l.notes)],
      tab: "leads",
    });
  }

  for (const i of invoices) {
    if (i.status === "Paid" || !isIsoDate(i.dueDate)) continue;
    const total = money(inc(i.items));
    events.push({
      uid: `invoice-${i.id}`,
      kind: "invoice",
      ref: { table: "invoices", id: i.id, field: "dueDate" },
      date: i.dueDate,
      time: null,
      name: i.clientName || "Client",
      label: "Invoice due",
      subtitle: [i.docNumber, `${total} inc. GST`].filter(Boolean).join(" · "),
      summary: `Invoice due – ${i.clientName || "Client"}${i.docNumber ? ` ${i.docNumber}` : ""}`,
      location: place(i),
      lines: [`${total} inc. GST`],
      tab: "invoices",
    });
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
}
