// Turns leads into the stops the visit planner works with, and decides what has to be left out.
import { isIsoDate, addDaysIso } from "./jobSchedule";
import { parseTime, VISIT_MIN } from "./visitPlanner";
import { parseNotesAvailability, ownNotes } from "./availability";

// Leads still waiting on a quote visit (once a lead is Quoted / Won / Lost the visit's done).
const ACTIVE = new Set(["New", "Contacted"]);
const NO_ADDRESS = /^(n\/?a|none|-|tbc|tba|unknown)?$/i;

// A "?" after the name means they haven't confirmed they're available, so they're left out for now.
export const isUnconfirmed = (name) => /\?/.test(String(name || ""));

// Text to look up on the map. A bare suburb gets "Gold Coast" added so it lands in the right place.
export function mapQuery(address) {
  const a = String(address || "").trim().replace(/\s+/g, " ");
  if (NO_ADDRESS.test(a)) return null;
  return /\d/.test(a) ? `${a}, QLD, Australia` : `${a}, Gold Coast QLD, Australia`;
}

const cleanName = (n) => String(n || "").replace(/\?/g, "").trim() || "Lead";
const lengthFromNotes = (notes) => {
  const m = /(\d{1,3})\s*min/i.exec(String(notes || ""));
  return m ? Math.min(180, Math.max(5, Number(m[1]))) : VISIT_MIN;
};

// -> { confirmed: stops with a date, flexible: stops with no date yet, left: [{ name, why }] }
export function collectVisits(leads, quotes, today) {
  const confirmed = [];
  const flexible = [];
  const left = [];

  for (const l of leads) {
    if (!ACTIVE.has(l.status)) continue;
    const dated = isIsoDate(l.visitDate);
    if (dated && l.visitDate < today) continue; // already gone

    const label = cleanName(l.name);
    if (isUnconfirmed(l.name)) {
      left.push({ name: label, why: "availability not confirmed (has a ?)", date: dated ? l.visitDate : null });
      continue;
    }
    const query = mapQuery(l.address);
    if (!query) {
      if (dated) left.push({ name: label, why: "no address", date: l.visitDate });
      continue; // an undated lead with no address isn't a visit yet — nothing to say
    }

    // Availability written in the lead's notes ("Available from 3:30pm onwards.") becomes a hard window for the plan.
    const avail = parseNotesAvailability(l.notes);
    const stop = {
      id: `lead:${l.id}`,
      leadId: l.id,
      name: label,
      address: String(l.address || "").trim(),
      jobType: l.jobType || "",
      phone: l.phone || "",
      notes: l.notes || "",
      query,
      preferred: dated ? parseTime(l.visitTime) : null,
      notBefore: avail.notBefore,
      notAfter: avail.notAfter,
      durationMin: lengthFromNotes(ownNotes(l.notes)),
      locked: false,
    };

    if (dated) {
      confirmed.push({ ...stop, date: l.visitDate });
    } else {
      // A visit with no day yet (e.g. a site visit for a booked job): it has to happen before that job starts.
      const baseName = label.replace(/\(.*?\)/g, "").trim().toLowerCase(); // "Haydn (site visit)" -> "haydn"
      const job = quotes.find((q) => q.status === "Accepted" && String(q.clientName || "").trim().toLowerCase() === baseName && isIsoDate(q.startDate));
      flexible.push({ ...stop, deadline: job ? addDaysIso(job.startDate, -1) : null, deadlineFor: job ? job.clientName : null });
    }
  }
  return { confirmed, flexible, left };
}

// Saturday / Sunday plans start from Burleigh in the morning, Friday leaves Cleveland at 11, other weekdays are after work.
export function defaultDaySettings(date) {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sun .. 6 Sat
  // flexDepart: the time is the earliest you can leave, and the plan picks the best time from there.
  if (dow === 6 || dow === 0) return { start: "burleigh", depart: 9 * 60, earliestStart: 9 * 60, flexDepart: true };
  if (dow === 5) return { start: "cleveland", depart: 11 * 60, earliestStart: 0, flexDepart: true };
  return { start: "cleveland", depart: null, earliestStart: 15 * 60, flexDepart: false };
}

export const isSaturday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 6;
