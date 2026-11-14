// The facts "Ask the hub" answers from: one compact text block built from the leads, quotes, invoices and expenses.
// Phone numbers and email addresses are left out (a question about money, jobs or clients doesn't need them, and less leaves the hub).
// Totals per month are worked out here so the AI reads them instead of adding up rows (it's better at reading than at long sums).
import { itemsTotal, gstBreakdown, isDepositInvoice } from "./logic";
import { SYSTEM_CATEGORY } from "./systemRows";

const incTotal = (items) => gstBreakdown(itemsTotal(items)).total;
const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString("en-AU")}`;
const day = (v) => String(v || "").slice(0, 10) || "-";
const month = (v) => String(v || "").slice(0, 7);
const clean = (s, n = 80) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

export function buildAskContext({ leads = [], quotes = [], invoices = [], expenses = [], todayIso }) {
  const lines = [];
  lines.push(`Today is ${todayIso}. Business: Lyons Fencing & Services (Gold Coast, Queensland). All amounts are AUD. "inc" means including GST.`);

  // ---- month by month
  const income = {}, labour = {}, supplies = {}, accepted = {}, sentCount = {};
  for (const i of invoices) {
    if (i.status === "Paid" && i.paidDate) income[month(i.paidDate)] = (income[month(i.paidDate)] || 0) + incTotal(i.items);
  }
  for (const q of quotes) {
    if (q.status === "Accepted") accepted[month(q.date)] = (accepted[month(q.date)] || 0) + incTotal(q.items);
    if (q.status !== "Draft") sentCount[month(q.date)] = (sentCount[month(q.date)] || 0) + 1;
  }
  for (const e of expenses) {
    if (e.category === "Labour invoice") labour[month(e.date)] = (labour[month(e.date)] || 0) + (Number(e.amount) || 0);
    else if (e.category === "Supplier invoice") supplies[month(e.date)] = (supplies[month(e.date)] || 0) + (Number(e.amount) || 0);
  }
  const months = [...new Set([...Object.keys(income), ...Object.keys(labour), ...Object.keys(supplies), ...Object.keys(accepted), ...Object.keys(sentCount)])].filter(Boolean).sort();
  lines.push("\nMONTH BY MONTH (month: paid invoices received inc GST | quotes sent | quotes accepted inc GST | labour invoices (Usher) | supplier invoices inc GST):");
  for (const m of months) lines.push(`${m}: ${money(income[m])} | ${sentCount[m] || 0} sent | ${money(accepted[m])} | ${money(labour[m])} | ${money(supplies[m])}`);

  // ---- quotes, newest first
  const qs = [...quotes].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 160);
  lines.push(`\nQUOTES (number | client | suburb | job | status | date | total inc GST | start date | notes):`);
  for (const q of qs) lines.push([q.docNumber || q.id, clean(q.clientName, 40), clean(q.suburb || q.address, 40), q.jobType || "-", q.status, day(q.date), money(incTotal(q.items)), q.startDate ? day(q.startDate) : "-", clean(q.title || q.notes, 70)].join(" | "));

  // ---- invoices
  const is = [...invoices].sort((a, b) => String(b.issuedDate || "").localeCompare(String(a.issuedDate || ""))).slice(0, 120);
  lines.push(`\nINVOICES (number | client | status | issued | due | paid | total inc GST | kind):`);
  for (const i of is) lines.push([i.docNumber || i.id, clean(i.clientName, 40), i.status, day(i.issuedDate), day(i.dueDate), day(i.paidDate), money(incTotal(i.items)), isDepositInvoice(i) ? "deposit" : "final"].join(" | "));

  // ---- leads
  const ls = [...leads].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 100);
  lines.push(`\nLEADS (name | source | status | came in | job type | address):`);
  for (const l of ls) lines.push([clean(l.name, 40), l.source || "not recorded", l.status, day(l.createdAt), l.jobType || "-", clean(l.address, 50)].join(" | "));

  // ---- other recorded expenses (not the hub's own bookkeeping rows)
  const other = expenses.filter((e) => e.category !== SYSTEM_CATEGORY && e.category !== "Labour invoice" && e.category !== "Supplier invoice").slice(0, 60);
  if (other.length) {
    lines.push(`\nOTHER EXPENSES (category | amount | date | what):`);
    for (const e of other) lines.push([e.category || "-", money(e.amount), day(e.date), clean(e.description, 60)].join(" | "));
  }
  lines.push("\nNot available here: phone numbers, email addresses, per-job profit (materials cost estimates), the calendar, and anything before the hub was used.");
  return lines.join("\n");
}

export const ASK_SYSTEM = `You are the assistant inside Artie Lyons' business hub for Lyons Fencing & Services, a one-man fencing business on the Gold Coast (he works with one labourer, Usher).
Answer his question using ONLY the facts below. Never invent numbers, names or dates. If the facts don't cover it, say so in one sentence and say what you'd need.
Be short and plain, like a mate who knows the books: a sentence or two, or a few short lines. Australian English. Amounts as $1,234. Say whether a figure is inc GST.
No markdown at all (no asterisks, hashes, bullets, tables): your answer may be read out loud. Use "and" or new lines to list things.
When he asks about money in or out, use the MONTH BY MONTH lines for totals instead of adding rows yourself. "Made" or "earned" means paid invoices received unless he says otherwise; mention if there are unpaid invoices that would change the picture.
Quotes marked Sent with no answer are still open, but one sent more than 21 days ago with no reply counts as lost (the hub treats it that way). Win rate = accepted / (accepted + declined + lost). Quote numbers look like LFS529.`;
