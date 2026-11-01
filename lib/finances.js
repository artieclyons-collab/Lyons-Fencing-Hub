// Finances: income from paid invoices, expenses from each job's estimated materials cost (no receipts to log),
// grouped by job and by week. Everything is inc. GST: invoices are billed with GST on top and the materials costs are entered inc. GST.
import { itemsTotal, gstBreakdown, templateMaterialsCost, isDepositInvoice } from "./logic";
import { JOB_TEMPLATES } from "./constants";

const isoOf = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || "")) ? String(s).slice(0, 10) : "");
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const invoiceTotal = (inv) => gstBreakdown(itemsTotal(inv.items)).total;
const invoiceDate = (inv) => isoOf(inv.paidDate) || isoOf(inv.issuedDate);

// The estimated materials cost of a quote: what "Calculate materials" added, plus costed templates' $/m x length.
export const quoteMaterials = (q, materials) => round2((Number(q.materialsCost) || 0) + templateMaterialsCost(q.items, JOB_TEMPLATES, materials));

const toDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const toIso = (dt) => dt.toISOString().slice(0, 10);
export const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
// Monday of the week the date falls in
export const weekStart = (iso) => addDays(iso, -((toDate(iso).getUTCDay() + 6) % 7));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (iso) => (iso ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}` : "");
export const weekLabel = (start) => `${shortDate(start)} – ${shortDate(addDays(start, 6))}`;

// One entry per job: an accepted quote and all the invoices raised for it (deposit + final), plus invoices that have no quote.
// -> [{ key, name, address, jobType, docNumber, quote, invoices, quotedTotal, billed, paid, owing, materials, started, expenseDate, lastDate }]
export function buildJobs({ quotes = [], invoices = [], materials = [], today }) {
  const byId = new Map(quotes.map((q) => [q.id, q]));
  const byDoc = new Map(quotes.filter((q) => q.docNumber).map((q) => [q.docNumber, q]));
  const accepted = quotes.filter((q) => q.status === "Accepted");
  const quoteFor = (inv) => {
    if (inv.quoteId && byId.has(inv.quoteId)) return byId.get(inv.quoteId);
    for (const m of String(inv.notes || "").match(/\bLFS\d+\b/g) || []) if (byDoc.has(m)) return byDoc.get(m);
    const same = accepted.filter((q) => norm(q.clientName) && norm(q.clientName) === norm(inv.clientName));
    return same.length === 1 ? same[0] : null; // an older invoice with no link: only when the client has just the one accepted quote
  };

  const jobs = new Map();
  const jobFor = (q, inv) => {
    const key = q ? q.id : `inv:${norm(inv.clientName)}|${norm(inv.address)}`;
    if (!jobs.has(key)) jobs.set(key, { key, quote: q || null, invoices: [], name: (q || inv).clientName || "Untitled", address: [(q || inv).address, (q || inv).suburb].filter(Boolean).join(", "), jobType: (q || inv).jobType || "", docNumber: q?.docNumber || "" });
    return jobs.get(key);
  };
  for (const q of accepted) jobFor(q);
  for (const inv of invoices) jobFor(quoteFor(inv), inv).invoices.push(inv);

  return [...jobs.values()].map((j) => {
    const invs = [...j.invoices].sort((a, b) => invoiceDate(a).localeCompare(invoiceDate(b)));
    const billed = round2(invs.reduce((s, i) => s + invoiceTotal(i), 0));
    const paid = round2(invs.filter((i) => i.status === "Paid").reduce((s, i) => s + invoiceTotal(i), 0));
    const est = j.quote ? quoteMaterials(j.quote, materials) : 0;
    const start = isoOf(j.quote?.startDate);
    const firstPaid = invs.filter((i) => i.status === "Paid").map(invoiceDate).filter(Boolean).sort()[0] || "";
    // The materials are counted once the job is under way: its start date has come, or (no start date) money has come in for it.
    const started = start ? start <= today : paid > 0;
    const expenseDate = started ? (start || firstPaid) : "";
    const dates = (invs.length ? invs.map(invoiceDate) : [start]).filter(Boolean).sort(); // newest first in the lists: by the latest invoice, else the start date
    return {
      ...j, invoices: invs, billed, paid, owing: round2(billed - paid), materials: est, started, expenseDate,
      quotedTotal: j.quote ? round2(invoiceTotal(j.quote)) : null, lastDate: dates[dates.length - 1] || "",
      // which date puts a job in a "since …" range: when it started (or, with no start date, its first invoice)
      jobDate: start || dates[0] || "",
    };
  });
}

// Jobs that started on or after `from` (an ISO date; empty = all of them).
export const jobsSince = (jobs, from) => (from ? jobs.filter((j) => j.jobDate && j.jobDate >= from) : jobs);

// Booked jobs that haven't started: their deposits are in the income, their materials aren't in the expenses yet.
export function bookedSummary(jobs) {
  const list = jobs.filter((j) => !j.started && (j.paid > 0 || j.materials > 0));
  return { count: list.length, deposits: round2(list.reduce((s, j) => s + j.paid, 0)), materials: round2(list.reduce((s, j) => s + j.materials, 0)) };
}

export function totalsOf(jobs) {
  const income = round2(jobs.reduce((s, j) => s + j.paid, 0));
  const expense = round2(jobs.filter((j) => j.started).reduce((s, j) => s + j.materials, 0));
  return { income, expense, net: round2(income - expense), owing: round2(jobs.reduce((s, j) => s + j.owing, 0)) };
}

export const jobAmount = (j, metric) => (metric === "income" ? j.paid : metric === "expense" ? (j.started ? j.materials : 0) : round2(j.paid - (j.started ? j.materials : 0)));

// Week by week (Monday to Sunday), newest first, every week from the first one with anything in it up to this week.
// Each week: { start, income, expense, net, lines: [{ kind: "income"|"expense", job, amount, label }] }
export function buildWeeks(jobs, today) {
  const weeks = new Map();
  const at = (iso) => {
    const s = weekStart(iso);
    if (!weeks.has(s)) weeks.set(s, { start: s, income: 0, expense: 0, lines: [] });
    return weeks.get(s);
  };
  for (const j of jobs) {
    for (const i of j.invoices) {
      const d = invoiceDate(i);
      if (i.status !== "Paid" || !d) continue;
      const w = at(d);
      const amount = invoiceTotal(i);
      w.income += amount;
      w.lines.push({ kind: "income", job: j, amount, label: `${isDepositInvoice(i) ? "Deposit" : "Invoice"} ${i.docNumber || ""}`.trim(), date: d });
    }
    if (j.started && j.expenseDate && j.materials > 0) {
      const w = at(j.expenseDate);
      w.expense += j.materials;
      w.lines.push({ kind: "expense", job: j, amount: j.materials, label: "Estimated materials", date: j.expenseDate });
    }
  }
  if (weeks.size === 0) return [];
  const first = [...weeks.keys()].sort()[0];
  const out = [];
  for (let s = first, guard = 0; s <= weekStart(today) && guard < 400; s = addDays(s, 7), guard++) {
    const w = weeks.get(s) || { start: s, income: 0, expense: 0, lines: [] };
    out.push({ ...w, income: round2(w.income), expense: round2(w.expense), net: round2(w.income - w.expense), lines: w.lines.sort((a, b) => a.date.localeCompare(b.date)) });
  }
  return out.reverse();
}
