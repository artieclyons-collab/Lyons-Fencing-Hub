// Referrals: a client who sends someone to you earns a $100 Visa gift card (a business expense), once the NEW client's job is worth at least $1,000
// and their final invoice has been paid. The hub notices "referred by Sam" in a text or email (or you type it on the lead), keeps it on the lead's
// notes as a line, and tells you when a reward is due. Nothing needs a database change:
//   "Referred by: Sam Jones."                          who sent them
//   "Referral reward given (21 Nov): $100 gift card."  the reward has been paid out (the hub also logs a $100 expense, id "ref-<leadId>")
// Pure functions, easy to test.
import { itemsTotal, gstBreakdown, isDepositInvoice } from "./logic";
import { quotesForLead } from "./quoteDecision";

export const REFERRAL_REWARD = 100;
export const REFERRAL_MIN_JOB = 1000; // job total inc GST
export const REFERRAL_EXPENSE_PREFIX = "ref-";

export const REFERRED_LINE = /^Referred by:\s*(.+?)\.?\s*$/im;
export const REWARD_LINE = /^Referral reward given \(([^)]*)\):?\s*(.*)$/im;

export const referredBy = (notes) => (REFERRED_LINE.exec(String(notes || ""))?.[1] || "").trim();
export const rewardGiven = (notes) => { const m = REWARD_LINE.exec(String(notes || "")); return m ? { when: m[1].trim(), text: m[2].trim() } : null; };

export function setReferredBy(notes, name) {
  const n = String(name || "").replace(/\s+/g, " ").trim();
  const rest = String(notes || "").split("\n").filter((l) => !REFERRED_LINE.test(l)).join("\n").trim();
  return n ? [rest, `Referred by: ${n}.`].filter(Boolean).join("\n") : rest;
}
export const markRewardGiven = (notes, whenLabel) =>
  rewardGiven(notes) ? String(notes) : [String(notes || "").trim(), `Referral reward given (${whenLabel}): $${REFERRAL_REWARD} gift card.`].filter(Boolean).join("\n");

// Words that look like a name at the start of a sentence but aren't a person you'd give a gift card to.
const NOT_A_NAME = /^(?:google|facebook|instagram|hipages|bark|gumtree|bunnings|tiktok|youtube|the|a|an|my|our|your|their|his|her|neighbou?rs?|friends?|family|someone|somebody|people|everyone|anyone|they|he|she|we|you|i|it|this|that|word|mum|dad|mom|and|from|for|who|just|also)$/i;
// Matched without regard to case (so "Got your number from…" works at the start of a sentence); the name that was picked up must then really be capitalised.
const NAME = "([a-z]{2,15}(?:[ ][a-z]{2,15})?)";
const TO_ME = String.raw`(?:to\s+(?:me|us|you|your\s+business)\s+)?`;
const PATTERNS = [
  new RegExp(String.raw`\b(?:referred|recommended|suggested|sent)\s+(?:me|us)\s+${TO_ME}by\s+${NAME}`, "gi"),
  new RegExp(String.raw`\b(?:referred|recommended|suggested)\s+${TO_ME}by\s+${NAME}`, "gi"),
  new RegExp(String.raw`\b${NAME}\s+(?:recommended|referred|suggested)\s+(?:you|your|us\s+to\s+you)`, "gi"),
  new RegExp(String.raw`\b(?:got|have|was\s+given|were\s+given|received)\s+(?:your|ur)\s+(?:number|details|name|contact(?:\s+details)?|info)\s+from\s+${NAME}`, "gi"),
  new RegExp(String.raw`\b${NAME}\s+(?:told|said\s+to)\s+(?:me|us)\s+(?:about\s+you|to\s+(?:call|contact|text|ring|message|get\s+in\s+touch\s+with)\s+you)`, "gi"),
  new RegExp(String.raw`\b${NAME}\s+gave\s+(?:me|us)\s+(?:your|ur)\s+(?:number|details|name|contact)`, "gi"),
  new RegExp(String.raw`\breferral\s+from\s+${NAME}`, "gi"),
];

// "Hi Artie, Sam Jones recommended you for our fence" -> "Sam Jones"; "" when no person is named.
export function detectReferral(text) {
  const t = String(text || "").replace(/\s+/g, " ");
  for (const re of PATTERNS) {
    for (const m of t.matchAll(re)) {
      // only the capitalised words are the name ("Karen from" -> "Karen"; "neighbour" -> nothing)
      const words = m[1].trim().split(" ").filter((w) => /^[A-Z][a-z]+$/.test(w) && !NOT_A_NAME.test(w));
      if (words.length) return words.slice(0, 2).join(" ");
    }
  }
  return "";
}

// Adds "Referred by: X." to a lead's notes when a message names who sent them (never overwrites one that's already there).
export function noteReferral(notes, text) {
  if (referredBy(notes)) return notes;
  const who = detectReferral(text);
  return who ? setReferredBy(notes, who) : notes;
}

const incTotal = (items) => gstBreakdown(itemsTotal(items)).total;
const nameKey = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Where each referred client's reward stands -> [{ lead, referrer, state, jobTotal, why }], owed first.
//   given:   the reward has been paid
//   owed:    the job is over $1,000, there is a final invoice and everything is paid -> give the gift card
//   waiting: the job is on (accepted, or an invoice is out) and we're waiting for the final invoice to be paid
//   quoted:  they haven't accepted a quote yet
//   small:   the job is under the minimum
//   lost:    the lead was lost / declined
export function referralRewards(leads, quotes, invoices) {
  const out = [];
  for (const l of leads || []) {
    const referrer = referredBy(l.notes);
    if (!referrer) continue;
    const given = rewardGiven(l.notes);
    const accepted = quotesForLead(quotes || [], l).filter((q) => q.status === "Accepted");
    const ids = new Set(accepted.map((q) => q.id));
    const mine = (invoices || []).filter((i) => (i.quoteId && ids.has(i.quoteId)) || (!i.quoteId && nameKey(i.clientName) && nameKey(i.clientName) === nameKey(l.name)));
    const finals = mine.filter((i) => !isDepositInvoice(i));
    const quoted = round2(accepted.reduce((s, q) => s + incTotal(q.items), 0));
    const billed = round2(mine.reduce((s, i) => s + incTotal(i.items), 0));
    const jobTotal = Math.max(quoted, billed);
    let state, why;
    if (given) { state = "given"; why = `Reward given ${given.when}`; }
    else if (l.status === "Lost" || (!accepted.length && !mine.length && l.status === "Declined")) { state = "lost"; why = "They didn't go ahead"; }
    else if (!accepted.length && !mine.length) { state = "quoted"; why = l.status === "Won" ? "Won, no quote on file yet" : "Hasn't accepted a quote yet"; }
    else if (jobTotal < REFERRAL_MIN_JOB) { state = "small"; why = `Job is under $${REFERRAL_MIN_JOB.toLocaleString()}`; }
    else if (finals.length && finals.every((i) => i.status === "Paid")) { state = "owed"; why = "Final invoice paid"; }
    else { state = "waiting"; why = finals.length ? "Waiting for the final invoice to be paid" : "Waiting for the job to be finished and invoiced"; }
    out.push({ lead: l, referrer, state, jobTotal, why });
  }
  const order = { owed: 0, waiting: 1, quoted: 2, small: 3, given: 4, lost: 5 };
  return out.sort((a, b) => order[a.state] - order[b.state]);
}
