// Does this lead's client already have a quote? A lead that does (a site visit for a job that's been quoted or booked, a client who
// texted again after being quoted) is not a new lead and shouldn't be offered "Start quote" or a first "intro text".
// Matched by phone, email or name (a "(site visit)" or "?" on the lead's name is ignored), the same way texts and emails are matched.
// Quotes that were declined don't count: a client who said no and comes back is quoted afresh.
import { quotesForLead } from "./quoteDecision";

export const existingQuotes = (lead, quotes) => quotesForLead(quotes || [], lead || {}).filter((q) => q.status !== "Declined");
export const hasQuote = (lead, quotes) => existingQuotes(lead, quotes).length > 0;

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
