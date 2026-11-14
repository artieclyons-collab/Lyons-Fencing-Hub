// Does this lead's client already have a quote? A lead that does (a site visit for a job that's been quoted or booked, a client who
// texted again after being quoted) is not a new lead and shouldn't be offered "Start quote" or a first "intro text".
// Matched by phone, email or name (a "(site visit)" or "?" on the lead's name is ignored), the same way texts and emails are matched.
// Quotes that were declined don't count: a client who said no and comes back is quoted afresh.
import { quotesForLead } from "./quoteDecision";

export const existingQuotes = (lead, quotes) => quotesForLead(quotes || [], lead || {}).filter((q) => q.status !== "Declined");
export const hasQuote = (lead, quotes) => existingQuotes(lead, quotes).length > 0;

// Is this lead already dealt with by a quote? A "New" lead whose client has a quote is usually the same enquiry (so it isn't "new" and gets no
// Start quote button), UNLESS it came in after their latest quote: a returning client asking for more work (Jessie: 2 fence posts). Those still
// show as new and can start a quote.
export function coveredByQuote(lead, quotes) {
  const mine = existingQuotes(lead, quotes);
  if (!mine.length) return false;
  if (lead?.status === "New" || lead?.status === "Contacted") {
    const latest = mine.map((q) => String(q.date || "")).sort().pop() || "";
    if (String(lead.createdAt || "").slice(0, 10) > latest) return false;
  }
  return true;
}

// The client a phone number or email belongs to, going by their quotes (a client who has a quote but no lead, like someone who's accepted
// and is texting about the job). Prefers an accepted quote, then a sent one, then the newest. -> { name, phone, email, address, jobType, status } or null
const tail9 = (s) => String(s || "").replace(/\D/g, "").slice(-9);
export function clientFromQuotes(quotes, { phone, email } = {}, invoices = []) {
  const p = tail9(phone);
  const e = String(email || "").trim().toLowerCase();
  const mine = (quotes || []).filter((q) => q.status !== "Declined" && ((p.length === 9 && tail9(q.clientPhone) === p) || (e && String(q.clientEmail || "").trim().toLowerCase() === e)));
  if (!mine.length) return null;
  const rank = (q) => (q.status === "Accepted" ? 0 : q.status === "Sent" ? 1 : 2);
  const q = [...mine].sort((a, b) => rank(a) - rank(b) || String(b.date || "").localeCompare(String(a.date || "")))[0];
  // the newest quote (or invoice) that has an email / a street address, not just the "best" quote, which may be missing them
  const newest = [...mine].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const mineIds = new Set(mine.map((x) => x.id));
  const theirInvoices = (invoices || []).filter((i) => (i.quoteId && mineIds.has(i.quoteId)) || (e && String(i.clientEmail || "").trim().toLowerCase() === e));
  const foundEmail = q.clientEmail || newest.find((x) => String(x.clientEmail || "").trim())?.clientEmail || theirInvoices.find((i) => String(i.clientEmail || "").trim())?.clientEmail || email || "";
  const addrSrc = newest.find((x) => String(x.address || "").trim()) || theirInvoices.find((i) => String(i.address || "").trim()) || q;
  return {
    name: String(q.clientName || "").replace(/\(.*?\)/g, "").replace(/\?/g, "").replace(/\s+/g, " ").trim(),
    phone: q.clientPhone || phone || "",
    email: foundEmail,
    address: [String(addrSrc.address || "").trim(), String(addrSrc.suburb || "").trim()].filter(Boolean).join(", "),
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

// The iPhone Shortcut gives a saved contact's NAME instead of their number, and contacts are saved as a name plus their suburb ("George
// Worongary", "Jessie Burleigh"). matchContact finds the one person it belongs to: the same first name, and then
//   - an exact name match wins;
//   - extra words in the contact ("Worongary") have to be in that person's name, address or suburb, which also tells two Georges apart;
//   - with no way to tell, it only matches when nobody else shares that first name (never a guess between two people).
// people: [{ name, place, ref }] -> the person, or null
const words = (s) => String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z]+/).filter(Boolean);
export function matchContact(contactName, people) {
  const c = words(contactName);
  if (!c.length || c[0].length < 3) return null;
  const same = (people || []).filter((p) => words(p.name)[0] === c[0]);
  if (!same.length) return null;
  const exact = same.filter((p) => words(p.name).join("") === c.join(""));
  if (exact.length === 1) return exact[0];
  const extras = c.slice(1);
  if (extras.length) {
    const hit = same.filter((p) => {
      const known = new Set([...words(p.name), ...words(p.place)]);
      return extras.every((w) => known.has(w));
    });
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) return null;
  }
  return same.length === 1 ? same[0] : null;
}

// a client who has quotes (and so a phone number), found by a saved contact's name -> the same as clientFromQuotes, or null
export function clientFromQuotesByName(quotes, contactName, invoices = []) {
  const byPhone = new Map();
  for (const q of quotes || []) {
    const p = tail9(q.clientPhone);
    if (q.status === "Declined" || p.length !== 9) continue;
    const cur = byPhone.get(p) || { name: q.clientName, place: "", ref: p };
    cur.place += ` ${q.address || ""} ${q.suburb || ""}`;
    byPhone.set(p, cur);
  }
  const hit = matchContact(contactName, [...byPhone.values()]);
  return hit ? clientFromQuotes(quotes, { phone: hit.ref }, invoices) : null;
}

// A text that asks for new work ("can you quote 2 fence post replacements", "need a gate fixed"), not one that just mentions a quote ("thanks for the quote").
export const asksForNewWork = (text) => {
  const s = String(text || "").replace(/[’‘ʼ]/g, "'");
  return /\b(?:request(?:ing)?|need(?:s|ed)?|want(?:s|ed)?|after|looking\s+(?:for|to)|require|can\s+you|could\s+you|would\s+you|please|interested)\b[^.?!]{0,80}\b(?:quote|quoting|price|pricing|estimate|replac\w*|repair\w*|fix\w*|new\s+fence)\b/i.test(s);
};

// A neighbour's invoice is linked to the same quote as the client's (a split job), so a phone number or email found "through the quote" can
// belong to the OTHER person. Only use a linked quote's details when its client is the same person as the document's.
const firstWord = (s) => String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z]+/).filter(Boolean)[0] || "";
export const sameClientName = (a, b) => {
  const x = firstWord(a), y = firstWord(b);
  return !!x && x === y;
};
