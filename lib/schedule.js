// Everything in the hub that has a date attached, in one place. The Board's
// "Coming up" list and the iPhone calendar feed (lib/calendarFeed.js) both read
// from this, so what you see on the Board is what lands in your calendar.
//
//   job       accepted quote with a start date
//   visit     lead with a site visit date (and optionally a time)
//   (quote follow-ups are NOT calendar events any more: they're one-tap texts under "Texts to send" on the Board)
//   invoice   unpaid invoice with a due date
import { gstBreakdown, itemsTotal, money } from "./logic";
import { isIsoDate, addDaysIso, jobDays, estimateHours, hoursLabel, worksSaturday } from "./jobSchedule";

// These two now live in jobSchedule.js; re-exported so existing imports keep working.
export { isIsoDate, addDaysIso };

export const FOLLOW_UP_DAYS = 3; // how long after sending a quote it appears under "Texts to send"

export const isTime = (s) => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);

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
      // One entry per working day the job covers (see jobSchedule.js for how long a job is).
      const spans = jobDays(q);
      const hours = estimateHours(q).hours;
      const long = spans.length > 1;
      spans.forEach((d, i) => {
        const part = d.portion < 1 ? `${hoursLabel(d.hours)} of work` : "";
        events.push({
          // The first day keeps the original id, so a calendar that already has it updates instead of duplicating.
          uid: i === 0 ? `job-${q.id}` : `job-${q.id}-d${i + 1}`,
          kind: "job",
          ref: { table: "quotes", id: q.id, field: "startDate" },
          editDate: q.startDate, // moving any day of a job moves the whole job, from its start date
          saturday: worksSaturday(q),
          dayIndex: i,
          dayCount: spans.length,
          portion: d.portion,
          hours: d.hours,
          date: d.date,
          time: null,
          name: q.clientName || "Client",
          label: long ? (i === 0 ? `Job start · day 1 of ${spans.length}` : `Job · day ${i + 1} of ${spans.length}`) : "Job start",
          subtitle: [q.jobType, long ? `${hoursLabel(hours)} job` : part, q.suburb, `${total} inc. GST`].filter(Boolean).join(" · "),
          summary: `Job${long ? ` day ${i + 1}/${spans.length}` : part ? ` (${hoursLabel(d.hours)})` : ""} – ${q.clientName || "Client"}${q.jobType ? ` (${q.jobType})` : ""}`,
          location: place(q),
          lines: [q.clientPhone && `Phone: ${q.clientPhone}`, q.docNumber && `Quote ${q.docNumber} — ${total} inc. GST`, q.notes && clip(q.notes)],
          tab: "quotes",
        });
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
