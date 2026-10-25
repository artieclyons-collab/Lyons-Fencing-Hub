// A client replying to a quote you've sent ("yep go ahead", "we've decided to go with someone else") moves that quote to
// Accepted or Declined. Deliberately strict, because the status drives your schedule and your follow-ups:
//   - only clear wording counts ("yes please" or "no thanks" alone don't — they could be answers to anything)
//   - a question, or any hedge ("if", "but", "once", "let me think"), counts as nothing
//   - it only acts when the client has exactly ONE quote with status Sent; with several it leaves them alone
// Used for forwarded texts and for emails. The caller saves what comes back.

import { isPlaceholderName } from "./leadName";

const norm = (s) => String(s || "").toLowerCase().replace(/[’‘ʼ]/g, "'").replace(/\s+/g, " ").trim();

const HEDGE = /\b(?:if|unless|once|but|however|as long as|provided|depends|depending|before we|not sure|maybe|perhaps|thinking|think about|discuss|talk to|talking to|check with|get back|wondering|could you|can you|would you|go ahead and (?:call|text|ring|park|use|knock|come in|open))\b/;

const DECLINE = [
  /\b(?:going|gone|went|decided to go|decided on going) with (?:someone|somebody|another|a different|an other|a cheaper|a local)\b/,
  /\b(?:not|\w+n't) (?:going|proceeding|moving|wanting) (?:ahead|forward|to proceed)\b/,
  /\bwon't be (?:going ahead|proceeding|needing)\b/,
  /\b(?:decided|deciding) (?:not to|against)\b/,
  /\bno longer (?:need|require|want|interested|going)\b/,
  /\bnot interested\b/,
  /\bpass on (?:this|the quote|your quote|it)\b/,
  /\btoo (?:expensive|pricey)\b/,
  /\bout of (?:our|my) budget\b/,
  /\bfound (?:someone|somebody|another|a cheaper)\b/,
  /\b(?:don't|do not|didn't) want to proceed\b/,
  /\bno need for the fenc\w*\b/,
];

const ACCEPT = [
  /\baccept (?:the|your|this) (?:quote|price|offer|estimate)\b/,
  /\b(?:we|i)(?:'ll| will|'d like to| would like to)? accept\b/,
  /\bhappy to accept\b/,
  /\bquote (?:is )?accepted\b/,
  /\bgo ahead\b|\b(?:happy|ready|keen|want|wanting|lets|let's) (?:to )?going ahead\b/,
  /\b(?:happy|keen|ready|want|wanting|like|please) to proceed\b|\bplease proceed\b|\blet's proceed\b|\blets proceed\b/,
  /\bbook (?:us|me|it|that|the job) in\b|\block (?:it|us|me|that) in\b|\blet's book\b|\blets book\b/,
  /\b(?:we|i)(?:'ll| will|'d like to| would like to|'ve decided to)? go with (?:you|your quote|your price)\b|\bgoing with you\b|\bchoose you\b/,
  /\bwhen (?:can|could) you (?:start|come|do it|begin)\b/,
  /\blet's do it\b|\blets do it\b|\bquote(?:'s)? approved\b|\bapproved\b/,
];

// -> "accept" | "decline" | null
export function detectDecision(text) {
  const s = norm(text);
  if (!s || s.length > 400) return null;
  const asksWhen = /\bwhen (?:can|could) you (?:start|come|do it|begin)\b/.test(s);
  if (/\?/.test(s) && !asksWhen) return null;
  const declined = DECLINE.some((re) => re.test(s));
  const accepted = ACCEPT.some((re) => re.test(s));
  if (declined && accepted) return null; // mixed signals
  // A decline can say "but" ("thanks for quoting, but…"); it can't be tentative.
  if (declined) return /\b(?:might|may|maybe|perhaps|if|unless|considering|thinking|not sure)\b/.test(s) ? null : "decline";
  if (!accepted) return null;
  // "when can you start" asks a question the hedge list would otherwise catch.
  return HEDGE.test(asksWhen ? s.replace(/\bwhen (?:can|could) you\b/g, "") : s) ? null : "accept";
}

const tail = (s) => String(s || "").replace(/\D/g, "").slice(-9);
const lc = (s) => String(s || "").trim().toLowerCase();
// "Haydn (site visit)" -> "haydn", "Sandy ?" -> "sandy"; a placeholder ("N/A", "Enquiry 04…") -> "" so it never matches anyone
const nameKey = (name) => (isPlaceholderName(name) ? "" : lc(String(name || "").replace(/\(.*?\)/g, "").replace(/\?/g, "").replace(/\s+/g, " ")));
const brisbaneDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(d);
const stampOf = (d) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
    .format(d)
    .replace(",", "")
    .replace(/\s?([ap])m/i, (_, x) => `${x.toLowerCase()}m`);

// Saves the quote's new status. On success the row in `quotes` is updated in place too, so the same message can't be applied twice.
export async function saveDecision(supabase, dec) {
  const { error } = await supabase.from("quotes").update(dec.quoteUpdate).eq("id", dec.quote.id);
  if (error) { console.log(`quote decision: couldn't save — ${error.message.slice(0, 120)}`); return false; }
  Object.assign(dec.quote, dec.quoteUpdate);
  return true;
}

// Quotes (rows from the database) that belong to this lead: same phone, same email, or the same name.
export function quotesForLead(quotes, lead) {
  const p = tail(lead.phone);
  const e = lc(lead.email);
  const n = nameKey(lead.name);
  return quotes.filter(
    (q) => (p.length === 9 && tail(q.clientPhone) === p) || (e && lc(q.clientEmail) === e) || (n && nameKey(q.clientName) === n)
  );
}

// -> null (nothing to do) or { decision, quote, quoteUpdate, leadPatch, noteLine, ambiguous }
//   quoteUpdate: columns to set on the quote. leadPatch: { status } to merge into the lead's update. noteLine: a line for the lead's notes.
// `via` is "text" or "email". The message itself is never stored.
export function decideQuote({ lead, quotes, text, via = "text", now = new Date() }) {
  const decision = detectDecision(text);
  if (!decision) return null;
  const sent = quotesForLead(quotes, lead).filter((q) => q.status === "Sent");
  if (sent.length === 0) return null;
  if (sent.length > 1) return { decision, ambiguous: true, quote: null };
  const quote = sent[0];
  const label = quote.docNumber || "quote";
  const when = stampOf(now);
  if (decision === "accept") {
    return {
      decision,
      quote,
      quoteUpdate: { status: "Accepted", acceptedAt: brisbaneDay(now), acceptedByName: quote.clientName || lead.name || "" },
      leadPatch: { status: "Won" },
      noteLine: `Quote ${label} marked Accepted automatically from their ${via} (${when}).`,
    };
  }
  return {
    decision,
    quote,
    quoteUpdate: { status: "Declined" },
    leadPatch: { status: "Lost" },
    noteLine: `Quote ${label} marked Declined automatically from their ${via} (${when}).`,
  };
}
