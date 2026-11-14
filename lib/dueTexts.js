// What's due under "Texts to send" (quote follow-ups, start dates, invoice chasers, review requests, new hipages leads).
// Lives here, not in the page component, so the server can count them for the morning phone alert (lib/push.js) too.
import { INTRO_TEXTS, introDraft, needsIntro } from "./introText";
import { hasQuote } from "./leadQuotes";
import { money, today, itemsTotal, gstBreakdown, isDepositInvoice } from "./logic";
import { isIsoDate } from "./jobSchedule";
import { FOLLOW_UP_DAYS } from "./schedule";
import { BIZ } from "./constants";
import { sameClientName } from "./leadQuotes";
import { casualAgo } from "./casualAgo";
import { isPalingQuote, palingSide, ASKED_SIDE } from "./palingSide";

export const CHASE_DAYS = 7; // an invoice is chased this long after it was issued
const REPEAT_DAYS = 7; // and again this long after each text
const QUOTE_WINDOW_DAYS = 30; // follow-ups stop after a month (a quote that old is probably dead)
const REVIEW_WINDOW_DAYS = 21; // review requests are offered for this long after a final invoice is paid
const START_SOON_DAYS = 14; // start-date texts are offered for jobs starting within this many days

export const DEFAULT_TEXTS = {
  ...INTRO_TEXTS,
  followUp: "Hi {name},\n\nJust following up on {quote} I sent through {ago}. Let me know if you have any questions or would like to go ahead.\n\nCheers,\nArtie",
  startConfirm: "Hi {name},\n\nThanks for accepting the quote! I've got you booked in to start on {date}. I'll be in touch beforehand if anything changes.\n\nCheers,\nArtie",
  startChange: "Hi {name},\n\nJust letting you know your start date has changed to {date}. Sorry for any inconvenience, and let me know if that doesn't suit.\n\nCheers,\nArtie",
  review: "Hi {name},\n\nThanks again for choosing us for your fencing. If you're happy with it, a quick Google review would really help: {link}\n\nCheers,\nArtie",
  palings: "Hi {name},\n\nBefore we start on {date}, which side would you like the palings to face: your side or the neighbour's?\n\nCheers,\nArtie",
  chase: "Hi {name},\n\nJust a quick reminder that {what} for {total} is still outstanding. The payment details are on the invoice. Let me know if you have any questions.\n\nThanks,\nArtie",
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
    const q = doc.quoteId ? quotes.find((x) => x.id === doc.quoteId && sameClientName(x.clientName, doc.clientName)) : null; // (a neighbour's invoice shares the quote with the client)
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
  // every quote number still out for the client, so the text names them all ("the fencing quotes (LFS529 and LFS530)")
  const outNums = new Map();
  for (const q of [...quotes].sort((a, b) => docNo(a) - docNo(b))) {
    if (q.status !== "Sent" || !q.docNumber) continue;
    const k = clientKey(q);
    outNums.set(k, [...(outNums.get(k) || []), q.docNumber]);
  }
  const quoteWords = (q) => {
    const nums = outNums.get(clientKey(q)) || [];
    if (nums.length <= 1) return `the fencing quote${nums[0] ? ` (${nums[0]})` : ""}`;
    return `the fencing quotes (${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]})`;
  };
  for (const q of quotes) {
    if (q.status !== "Sent" || newest.get(clientKey(q)) !== q) continue;
    const age = daysAgo(q.date);
    if (age == null || age < FOLLOW_UP_DAYS || age > QUOTE_WINDOW_DAYS) continue;
    const since = daysAgo(q.lastFollowUp);
    if (since != null && since < REPEAT_DAYS) continue;
    const body = fill(texts.followUp, { name: first(q.clientName), quote: quoteWords(q), doc: q.docNumber || "quote", days: age, ago: casualAgo(age), total: money(incTotal(q.items)), job: q.jobType || "fencing" });
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
  // A booked timber job that's starting soon and doesn't say which side the palings face yet: ask the client.
  for (const q of quotes) {
    if (q.status !== "Accepted" || !isPalingQuote(q) || !isIsoDate(q.startDate) || q.startDate < t0) continue;
    const side = palingSide(q.notes);
    if (side === "client" || side === "neighbour" || String(q.notes || "").includes(ASKED_SIDE)) continue;
    const until = -daysAgo(q.startDate);
    if (until > START_SOON_DAYS) continue;
    const body = fill(texts.palings, { name: first(q.clientName), doc: q.docNumber || "quote", date: longDate(q.startDate) });
    out.push({ key: `p:${q.id}`, kind: "ask", email: "", id: q.id, age: -until, badge: until === 0 ? "today" : `in ${until}d`, mark: { table: "quotes", id: q.id, field: "notes", value: `${String(q.notes || "").trim()}\n${ASKED_SIDE} (${today()}).`.replace(/^\n/, "") }, who: q.clientName || "Client", what: `Timber job · starts ${longDate(q.startDate)}`, label: "Ask paling side", phone: q.clientPhone || "", body });
  }
  const phoneFor = (inv) => {
    // the linked quote only counts when it's for the same person (Fiona's invoice is linked to Emma's quote)
    const q = quotes.find((x) => x.id === inv.quoteId && sameClientName(x.clientName, inv.clientName)) || quotes.find((x) => x.clientPhone && norm(x.clientName) === norm(inv.clientName));
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
  // Ask for a Google review once the job's done: from a day after the FINAL invoice goes out (the job is finished by then), not only
  // after it's paid, which can be weeks later and is why it gets forgotten. Once per job, remembered as "review:<date>" on the quote.
  // (An invoice for someone other than the quote's client, e.g. a neighbour's half, waits until it's paid and is remembered on the invoice.)
  const reviewed = new Set();
  for (const i of invoices) {
    if (isDepositInvoice(i) || String(i.lastChase || "").startsWith("review:")) continue;
    const q = i.quoteId ? quotes.find((x) => x.id === i.quoteId) : null;
    const sameClient = !!q && norm(q.clientName) === norm(i.clientName);
    const paid = i.status === "Paid";
    if (!paid && !sameClient) continue;
    if (sameClient && (String(q.lastFollowUp || "").startsWith("review:") || reviewed.has(q.id))) continue;
    const age = daysAgo(paid ? i.paidDate || i.issuedDate : i.issuedDate);
    if (age == null || age < 1 || age > REVIEW_WINDOW_DAYS) continue;
    if (!paid && age >= CHASE_DAYS) continue; // still unpaid once it's due for a chase: not the time to ask for a review, wait until it's paid
    if (sameClient) reviewed.add(q.id);
    const link = BIZ.reviewUrl || "";
    // with no review link saved, the sentence just ends there instead of pointing nowhere
    const tpl = link ? texts.review : texts.review.replace(": {link}", ".");
    const body = fill(tpl, { name: first(i.clientName), link });
    const mark = sameClient ? { table: "quotes", id: q.id, field: "lastFollowUp", value: `review:${today()}` } : { table: "invoices", id: i.id, field: "lastChase", value: `review:${today()}` };
    out.push({ key: `r:${sameClient ? q.id : i.id}`, kind: "review", email: emailFor(i), id: i.id, age, badge: `${age}d`, mark, who: i.clientName || "Client", what: `${i.docNumber || "Invoice"} ${paid ? "paid" : "sent"} · job done`, label: "Ask for a review", phone: phoneFor(i), body });
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
  const rank = (x) => (x.kind === "lead" ? -1 : x.kind === "job" || x.kind === "ask" ? 0 : x.kind === "review" ? 0.2 : x.kind === "invoice" ? 0.5 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || b.age - a.age); // a job's age is minus its days to go, so soonest first
}

