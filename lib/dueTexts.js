// What's due under "Texts to send" (quote follow-ups, start dates, invoice chasers, review requests, new hipages leads).
// Lives here, not in the page component, so the server can count them for the morning phone alert (lib/push.js) too.
import { INTRO_TEXTS, introDraft, needsIntro } from "./introText";
import { hasQuote } from "./leadQuotes";
import { money, today, itemsTotal, gstBreakdown, isDepositInvoice } from "./logic";
import { isIsoDate } from "./jobSchedule";
import { FOLLOW_UP_DAYS } from "./schedule";
import { BIZ } from "./constants";

export const CHASE_DAYS = 7; // an invoice is chased this long after it was issued
const REPEAT_DAYS = 7; // and again this long after each text
const QUOTE_WINDOW_DAYS = 30; // follow-ups stop after a month (a quote that old is probably dead)
const REVIEW_WINDOW_DAYS = 21; // review requests are offered for this long after a final invoice is paid
const START_SOON_DAYS = 14; // start-date texts are offered for jobs starting within this many days

export const DEFAULT_TEXTS = {
  ...INTRO_TEXTS,
  followUp: "Hi {name}, it's Artie from Lyons Fencing. Just following up on the fencing quote ({doc}) I sent through {days} days ago. Let me know if you have any questions or would like to go ahead. Cheers, Artie",
  startConfirm: "Hi {name}, it's Artie from Lyons Fencing. Thanks for accepting the quote! I've got you booked in to start on {date}. I'll be in touch beforehand if anything changes. Cheers, Artie",
  startChange: "Hi {name}, it's Artie from Lyons Fencing. Just letting you know your start date has changed to {date}. Sorry for any inconvenience, and let me know if that doesn't suit. Cheers, Artie",
  review: "Hi {name}, it's Artie from Lyons Fencing. Thanks again for choosing us for your fencing. If you're happy with it, a quick Google review would really help a small local business: {link} Cheers, Artie",
  chase: "Hi {name}, it's Artie from Lyons Fencing. Just a quick reminder that {what} for {total} is still outstanding. The payment details are on the invoice. Let me know if you have any questions. Thanks, Artie",
};

const longDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
const dayNum = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN;
};
const first = (name) => {
  const n = String(name || "").replace(/\(.*?\)/g, "").trim().split(/\s+/)[0] || "";
  return /^(n\/?a|lead|client)$/i.test(n) ? "" : n;
};
const isEmailish = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || "").trim());
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const incTotal = (items) => gstBreakdown(itemsTotal(items)).total;
const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)).replace(/^Hi ,/, "Hi,");

// Everything due right now, oldest first. `texts` is the wording; leads/quotes supply phone numbers for invoices.
// `todayIso` is the date to count from (the browser's own date by default; the server passes the Brisbane date).
export function dueTexts({ quotes, invoices, leads }, texts = DEFAULT_TEXTS, todayIso = today()) {
  const out = [];
  const daysAgo = (iso) => (iso ? dayNum(todayIso) - dayNum(iso) : null);
  // Where an email would go: the address saved on the document, else on the matching lead (by phone or name).
  const emailFor = (doc) => {
    if (isEmailish(doc.clientEmail)) return doc.clientEmail.trim();
    const q = doc.quoteId ? quotes.find((x) => x.id === doc.quoteId) : null;
    if (q && isEmailish(q.clientEmail)) return q.clientEmail.trim();
    const phone = String(doc.clientPhone || q?.clientPhone || "").replace(/\D/g, "").slice(-9);
    const l = leads.find((x) => isEmailish(x.email) && ((phone.length >= 8 && String(x.phone || "").replace(/\D/g, "").slice(-9) === phone) || norm(x.name) === norm(doc.clientName)));
    return l ? l.email.trim() : "";
  };
  // A client with several quotes out gets one follow-up, about their newest one (if that one isn't due yet, none of them is).
  const clientKey = (q) => {
    const p = String(q.clientPhone || "").replace(/\D/g, "").slice(-9);
    return p.length >= 8 ? `p${p}` : `n${norm(q.clientName)}`;
  };
  const docNo = (q) => Number(String(q.docNumber || "").match(/\d+/)?.[0]) || 0;
  const newest = new Map();
  for (const q of quotes) {
    if (q.status !== "Sent") continue;
    const k = clientKey(q);
    const cur = newest.get(k);
    if (!cur || String(q.date || "") > String(cur.date || "") || (q.date === cur.date && docNo(q) > docNo(cur))) newest.set(k, q);
  }
  for (const q of quotes) {
    if (q.status !== "Sent" || newest.get(clientKey(q)) !== q) continue;
    const age = daysAgo(q.date);
    if (age == null || age < FOLLOW_UP_DAYS || age > QUOTE_WINDOW_DAYS) continue;
    const since = daysAgo(q.lastFollowUp);
    if (since != null && since < REPEAT_DAYS) continue;
    const body = fill(texts.followUp, { name: first(q.clientName), doc: q.docNumber || "quote", days: age, total: money(incTotal(q.items)), job: q.jobType || "fencing" });
    out.push({ key: `q:${q.id}`, kind: "quote", email: emailFor(q), id: q.id, age, badge: `${age}d`, mark: { field: "lastFollowUp", value: today() }, who: q.clientName || "Client", what: `${q.jobType || "Quote"} · ${money(incTotal(q.items))} inc. GST`, label: since != null ? "Follow up again" : "Follow up", phone: q.clientPhone || "", body });
  }
  // A booked job: tell the client the start date, and again if the date moves (it's remembered as "start:<date>").
  const t0 = todayIso;
  for (const q of quotes) {
    if (q.status !== "Accepted" || !isIsoDate(q.startDate) || q.startDate < t0) continue;
    const until = -daysAgo(q.startDate); // days until it starts
    if (until > START_SOON_DAYS) continue;
    const told = q.lastFollowUp || "";
    if (told === `start:${q.startDate}`) continue;
    const changed = told.startsWith("start:");
    const body = fill(changed ? texts.startChange : texts.startConfirm, { name: first(q.clientName), doc: q.docNumber || "quote", date: longDate(q.startDate), total: money(incTotal(q.items)), job: q.jobType || "fencing" });
    out.push({ key: `s:${q.id}`, kind: "job", email: emailFor(q), id: q.id, age: -until, badge: until === 0 ? "today" : `in ${until}d`, mark: { field: "lastFollowUp", value: `start:${q.startDate}` }, who: q.clientName || "Client", what: `${q.jobType || "Job"} · starts ${longDate(q.startDate)}`, label: changed ? "Send new date" : "Confirm start", phone: q.clientPhone || "", body });
  }
  const phoneFor = (inv) => {
    const q = quotes.find((x) => x.id === inv.quoteId) || quotes.find((x) => x.clientPhone && norm(x.clientName) === norm(inv.clientName));
    if (q?.clientPhone) return q.clientPhone;
    return leads.find((l) => l.phone && norm(l.name) === norm(inv.clientName))?.phone || "";
  };
  for (const i of invoices) {
    if (i.status === "Paid") continue;
    const age = daysAgo(i.issuedDate);
    if (age == null || age < CHASE_DAYS) continue;
    const since = daysAgo(i.lastChase);
    if (since != null && since < REPEAT_DAYS) continue;
    const total = money(incTotal(i.items));
    const what = `${isDepositInvoice(i) ? "the deposit invoice" : "invoice"}${i.docNumber ? ` ${i.docNumber}` : ""}`;
    const body = fill(texts.chase, { name: first(i.clientName), doc: i.docNumber || "invoice", what, total, days: age });
    out.push({ key: `i:${i.id}`, kind: "invoice", email: emailFor(i), id: i.id, age, badge: `${age}d`, mark: { field: "lastChase", value: today() }, who: i.clientName || "Client", what: `${i.docNumber || "Invoice"} · ${total} inc. GST`, label: since != null ? "Chase again" : "Chase payment", phone: phoneFor(i), body });
  }
  // Paid final invoices: a day or more after being paid, ask for a Google review (once; remembered as "review:<date>" on the invoice).
  for (const i of invoices) {
    if (i.status !== "Paid" || isDepositInvoice(i) || String(i.lastChase || "").startsWith("review:")) continue;
    const age = daysAgo(i.paidDate || i.issuedDate);
    if (age == null || age < 1 || age > REVIEW_WINDOW_DAYS) continue;
    const link = BIZ.reviewUrl || "";
    // with no review link saved, the sentence just ends there instead of pointing nowhere
    const tpl = link ? texts.review : texts.review.replace(": {link}", ".");
    const body = fill(tpl, { name: first(i.clientName), link });
    out.push({ key: `r:${i.id}`, kind: "review", email: emailFor(i), id: i.id, age, badge: `${age}d`, mark: { field: "lastChase", value: `review:${today()}` }, who: i.clientName || "Client", what: `${i.docNumber || "Invoice"} paid`, label: "Ask for a review", phone: phoneFor(i), body });
  }
  // New hipages leads waiting for a first message (a draft to check and send — see IntroTextModal).
  for (const l of leads) {
    if (l.source !== "hipages" || !needsIntro(l) || hasQuote(l, quotes)) continue;
    const age = daysAgo(l.createdAt) ?? 0;
    if (age > 14) continue;
    out.push({ key: `l:${l.id}`, kind: "lead", lead: l, id: l.id, email: "", age: 0, badge: "new", who: l.name || "New lead", what: `${l.jobType || "Fencing"}${l.address ? ` · ${l.address}` : ""}`, label: "Write intro text", phone: l.phone, body: introDraft(l, texts) });
  }
  // New leads first, then start dates (soonest first), then the rest oldest first.
  // (then invoice chasers and review requests, which are time-limited, ahead of the quote follow-ups)
  const rank = (x) => (x.kind === "lead" ? -1 : x.kind === "job" ? 0 : x.kind === "invoice" || x.kind === "review" ? 0.5 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || b.age - a.age); // a job's age is minus its days to go, so soonest first
}

