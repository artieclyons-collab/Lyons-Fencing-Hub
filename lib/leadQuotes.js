// Does this lead's client already have a quote? A lead that does (a site visit for a job that's been quoted or booked, a client who
// texted again after being quoted) is not a new lead and shouldn't be offered "Start quote" or a first "intro text".
// Matched by phone, email or name (a "(site visit)" or "?" on the lead's name is ignored), the same way texts and emails are matched.
// Quotes that were declined don't count: a client who said no and comes back is quoted afresh.
import { quotesForLead } from "./quoteDecision";

export const existingQuotes = (lead, quotes) => quotesForLead(quotes || [], lead || {}).filter((q) => q.status !== "Declined");
export const hasQuote = (lead, quotes) => existingQuotes(lead, quotes).length > 0;

// The client a phone number or email belongs to, going by their quotes (a client who has a quote but no lead, like someone who's accepted
// and is texting about the job). Prefers an accepted quote, then a sent one, then the newest. -> { name, phone, email, address, jobType, status } or null
const tail9 = (s) => String(s || "").replace(/\D/g, "").slice(-9);
export function clientFromQuotes(quotes, { phone, email } = {}) {
  const p = tail9(phone);
  const e = String(email || "").trim().toLowerCase();
  const mine = (quotes || []).filter((q) => q.status !== "Declined" && ((p.length === 9 && tail9(q.clientPhone) === p) || (e && String(q.clientEmail || "").trim().toLowerCase() === e)));
  if (!mine.length) return null;
  const rank = (q) => (q.status === "Accepted" ? 0 : q.status === "Sent" ? 1 : 2);
  const q = [...mine].sort((a, b) => rank(a) - rank(b) || String(b.date || "").localeCompare(String(a.date || "")))[0];
  return {
    name: String(q.clientName || "").replace(/\(.*?\)/g, "").replace(/\?/g, "").replace(/\s+/g, " ").trim(),
    phone: q.clientPhone || phone || "",
    email: q.clientEmail || email || "",
    address: [q.address, q.suburb].filter(Boolean).join(", "),
    jobType: q.jobType || "",
    status: q.status === "Accepted" ? "Won" : "Quoted",
  };
}

const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

// "Quote LFS485 accepted, starts 2 Nov" / "Quote LFS488 sent" / "3 quotes already"
export function quoteTag(lead, quotes) {
  const list = existingQuotes(lead, quotes);
  if (list.length === 0) return "";
  if (list.length > 1) return `${list.length} quotes already`;
  const q = list[0];
  const status = String(q.status || "").toLowerCase();
  const starts = q.status === "Accepted" && /^\d{4}-\d{2}-\d{2}$/.test(q.startDate || "") ? `, starts ${shortDate(q.startDate)}` : "";
  return `Quote ${q.docNumber || ""} ${status}${starts}`.replace(/\s+/g, " ").trim();
}
