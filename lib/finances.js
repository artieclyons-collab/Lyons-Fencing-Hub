// Finances: income from paid invoices, expenses from each job's estimated materials and labour (no receipts to log),
// grouped by job and by week. Everything is inc. GST: invoices are billed with GST on top and the materials costs are entered inc. GST.
import { itemsTotal, gstBreakdown, templateMaterialsCost, isDepositInvoice } from "./logic";
import { JOB_TEMPLATES, LABOUR_RATES } from "./constants";
import { estimateHours } from "./jobSchedule";

const isoOf = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || "")) ? String(s).slice(0, 10) : "");
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const invoiceTotal = (inv) => gstBreakdown(itemsTotal(inv.items)).total;
const invoiceDate = (inv) => isoOf(inv.paidDate) || isoOf(inv.issuedDate);

// The estimated materials cost of a quote: what "Calculate materials" added, plus costed templates' $/m x length.
export const quoteMaterials = (q, materials) => round2((Number(q.materialsCost) || 0) + templateMaterialsCost(q.items, JOB_TEMPLATES, materials));

// The labour cost filled in on a quote: employees (blank = one labourer, 0 = just you) x hours (typed, else the job's estimated hours) x the rate.
export function labourDetail(q) {
  const employees = q.employees === "" || q.employees == null ? 1 : Number(q.employees) || 0;
  const hours = Number(q.hours) > 0 ? Number(q.hours) : estimateHours(q).hours;
  const rate = (LABOUR_RATES.find((r) => r.id === q.labourRateType) || LABOUR_RATES[0]).rate;
  return { employees, hours, rate };
}
export const quoteLabour = (q) => { const d = labourDetail(q); return round2(d.employees * d.hours * d.rate); };

const toDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const toIso = (dt) => dt.toISOString().slice(0, 10);
export const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
// Monday of the week the date falls in
export const weekStart = (iso) => addDays(iso, -((toDate(iso).getUTCDay() + 6) % 7));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (iso) => (iso ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}` : "");
export const weekLabel = (start) => `${shortDate(start)} – ${shortDate(addDays(start, 6))}`;

// Street-name words of an address ("139 Gooding Drive, Merrimac" -> gooding), without numbers, suburbs and words like drive/road,
// used to tie a day on a labourer invoice to the job at that address.
const GENERIC = new Set(["unit", "cts", "villas", "drive", "road", "street", "avenue", "crescent", "court", "place", "close", "circuit", "parade", "lane", "terrace", "boulevard", "highway", "esplanade", "north", "south", "east", "west", "units", "lot", "apartment", "complex"]);
const addrWords = (addr, skip) =>
  String(addr || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && /[a-z]/.test(w) && !/\d/.test(w) && !GENERIC.has(w) && !skip.has(w));

// One entry per job: an accepted quote and all the invoices raised for it (deposit + final), plus invoices that have no quote.
// -> [{ key, name, address, jobType, docNumber, quote, invoices, quotedTotal, billed, paid, owing, materials, started, expenseDate, lastDate }]
export function buildJobs({ quotes = [], invoices = [], materials = [], labourLines = [], supplierInvoices = [], today }) {
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

  // Days on the labourer's invoices go to the job at that address (split by estimated labour if two jobs share it);
  // days that match nothing are kept as their own "no matching job" entries so the money still shows.
  const suburbWords = new Set([...quotes, ...invoices].flatMap((x) => String(x.suburb || "").toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean));
  const jobList = [...jobs.values()];
  const words = new Map(jobList.map((j) => [j.key, new Set([j.quote?.address, j.address, ...j.invoices.map((i) => i.address)].flatMap((a) => addrWords(a, suburbWords)))]));
  const labourFor = new Map(jobList.map((j) => [j.key, []]));
  const unmatched = new Map();
  const lastLabourDay = labourLines.map((l) => l.date).sort().pop() || ""; // the latest day any labourer invoice covers
  for (const line of labourLines) {
    const lw = addrWords(line.address, suburbWords);
    const hits = lw.length ? jobList.filter((j) => lw.some((w) => words.get(j.key).has(w))) : [];
    if (hits.length === 0) {
      const k = `labour:${norm(line.address) || "none"}`;
      if (!unmatched.has(k)) unmatched.set(k, []);
      unmatched.get(k).push(line);
      continue;
    }
    const weights = hits.map((j) => (j.quote ? quoteLabour(j.quote) : 0) || 1);
    const total = weights.reduce((a, b) => a + b, 0);
    hits.forEach((j, n) => labourFor.get(j.key).push({ ...line, amount: round2((line.amount * weights[n]) / total), paid: round2((line.paid * weights[n]) / total) }));
  }

  // Supplier invoices go to the job they were picked for (or, failing that, the job at the delivery address; two jobs at one
  // address share it equally). Ones that match nothing stay as their own "no matching job" entries so the money still shows.
  const supplierFor = new Map(jobList.map((j) => [j.key, []]));
  const supUnmatched = [];
  for (const si of supplierInvoices) {
    const picked = si.quoteId ? jobList.find((j) => j.quote?.id === si.quoteId) : null;
    const sw = addrWords(si.address, suburbWords);
    const hits = picked ? [picked] : sw.length ? jobList.filter((j) => sw.some((w) => words.get(j.key).has(w))) : [];
    if (hits.length === 0) { supUnmatched.push(si); continue; }
    for (const j of hits) supplierFor.get(j.key).push(hits.length > 1 ? { ...si, total: round2(si.total / hits.length), shared: true } : si);
  }

  const built = jobList.map((j) => {
    const lines = labourFor.get(j.key);
    const sup = supplierFor.get(j.key);
    const invs = [...j.invoices].sort((a, b) => invoiceDate(a).localeCompare(invoiceDate(b)));
    const billed = round2(invs.reduce((s, i) => s + invoiceTotal(i), 0));
    const paid = round2(invs.filter((i) => i.status === "Paid").reduce((s, i) => s + invoiceTotal(i), 0));
    const quoteEst = j.quote ? quoteMaterials(j.quote, materials) : 0;
    // what was really paid to suppliers for this job, once any invoice has been added; until then the quote's estimate stands in
    const est = sup.length ? round2(sup.reduce((t, x) => t + x.total, 0)) : quoteEst;
    const start = isoOf(j.quote?.startDate);
    const firstPaid = invs.filter((i) => i.status === "Paid").map(invoiceDate).filter(Boolean).sort()[0] || "";
    // What the labourer actually billed for this job. A job from before his latest invoiced day with nothing billed on it had no
    // paid labour; only a job beyond that (not invoiced yet) uses the quote's own labour figure as a stand-in.
    const labour = lines.length ? round2(lines.reduce((t, l) => t + l.amount, 0)) : lastLabourDay && (start || firstPaid) && (start || firstPaid) <= lastLabourDay ? 0 : j.quote ? quoteLabour(j.quote) : 0;
    // The materials are counted once the job is under way: its start date has come, or (no start date) money has come in for it.
    const started = lines.length > 0 || sup.length > 0 || (start ? start <= today : paid > 0);
    const expenseDate = started ? (start || firstPaid || lines[0]?.date || sup[0]?.date || "") : "";
    const dates = (invs.length ? invs.map(invoiceDate) : [start]).filter(Boolean).sort(); // newest first in the lists: by the latest invoice, else the start date
    return {
      ...j, invoices: invs, billed, paid, owing: round2(billed - paid), materials: est, materialsActual: sup.length > 0, materialsEstimate: quoteEst, supplierInvoices: sup, labour, labourLines: lines, cost: round2(est + labour), started, expenseDate,
      quotedTotal: j.quote ? round2(invoiceTotal(j.quote)) : null, lastDate: dates[dates.length - 1] || "",
      // which date puts a job in a "since …" range: when it started (or, with no start date, its first invoice)
      jobDate: start || dates[0] || sup[0]?.date || lines[0]?.date || "",
    };
  });

  const orphans = [...unmatched.entries()].map(([key, lines]) => {
    const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date));
    const labour = round2(sorted.reduce((t, l) => t + l.amount, 0));
    return {
      key, quote: null, invoices: [], name: "Labour, no matching job", address: sorted[0].address || "", jobType: "", docNumber: "", billed: 0, paid: 0, owing: 0,
      materials: 0, labour, labourLines: sorted, cost: labour, started: true, expenseDate: sorted[0].date, quotedTotal: null,
      lastDate: sorted[sorted.length - 1].date, jobDate: sorted[0].date,
    };
  });
  const supOrphans = supUnmatched.map((si) => ({
    key: `mat:${si.id}`, quote: null, invoices: [], name: "Materials, no matching job", address: si.address || si.supplier || "", jobType: "", docNumber: "", billed: 0, paid: 0, owing: 0,
    materials: si.total, materialsActual: true, materialsEstimate: 0, supplierInvoices: [si], labour: 0, labourLines: [], cost: si.total, started: true, expenseDate: si.date,
    quotedTotal: null, lastDate: si.date, jobDate: si.date,
  }));
  return [...built, ...orphans, ...supOrphans];
}

// The jobs an address could be: street-name words in common (used to suggest a job for a supplier invoice's delivery address).
export function suggestJobs(jobs, address) {
  const suburbWords = new Set(jobs.flatMap((j) => String(j.address || "").split(",").slice(1).join(" ").toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean));
  const aw = addrWords(address, suburbWords);
  if (aw.length === 0) return [];
  return jobs.filter((j) => j.quote && addrWords(j.address, suburbWords).some((w) => aw.includes(w)));
}

// Jobs that started on or after `from` (an ISO date; empty = all of them).
export const jobsSince = (jobs, from) => (from ? jobs.filter((j) => j.jobDate && j.jobDate >= from) : jobs);

// Booked jobs that haven't started: their deposits are in the income, their materials and labour aren't in the expenses yet.
export function bookedSummary(jobs) {
  const list = jobs.filter((j) => !j.started && (j.paid > 0 || j.cost > 0));
  return { count: list.length, deposits: round2(list.reduce((s, j) => s + j.paid, 0)), costs: round2(list.reduce((s, j) => s + j.cost, 0)) };
}

export function totalsOf(jobs) {
  const income = round2(jobs.reduce((s, j) => s + j.paid, 0));
  const started = jobs.filter((j) => j.started);
  const expense = round2(started.reduce((s, j) => s + j.cost, 0));
  return { income, expense, materials: round2(started.reduce((s, j) => s + j.materials, 0)), labour: round2(started.reduce((s, j) => s + j.labour, 0)), net: round2(income - expense), owing: round2(jobs.reduce((s, j) => s + j.owing, 0)) };
}

export const jobAmount = (j, metric) => (metric === "income" ? j.paid : metric === "expense" ? (j.started ? j.cost : 0) : round2(j.paid - (j.started ? j.cost : 0)));

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
    // materials: each supplier invoice in the week it was bought; with none, the quote's estimate from the start date
    const matItems = j.supplierInvoices?.length
      ? j.supplierInvoices.map((x) => ({ amount: x.total, label: `Materials (${x.supplier || "supplier"}${x.number ? ` ${x.number}` : ""})`, date: x.date }))
      : j.started && j.expenseDate && j.materials > 0 ? [{ amount: j.materials, label: "Estimated materials", date: j.expenseDate }] : [];
    for (const m of matItems) {
      if (m.amount <= 0 || !m.date) continue;
      const w = at(m.date);
      w.expense += m.amount;
      w.lines.push({ kind: "expense", job: j, amount: m.amount, label: m.label, date: m.date });
    }
    // labour: each day on the labourer's invoices in its own week; otherwise the quote's estimate from the start date
    const labourItems = j.labourLines?.length ? j.labourLines.map((l) => ({ amount: l.amount, label: `Labour (invoice ${l.number})`, date: l.date })) : j.started && j.expenseDate && j.labour > 0 ? [{ amount: j.labour, label: "Labour (estimate)", date: j.expenseDate }] : [];
    for (const l of labourItems) {
      if (l.amount <= 0 || !l.date) continue;
      const w = at(l.date);
      w.expense += l.amount;
      w.lines.push({ kind: "expense", job: j, amount: l.amount, label: l.label, date: l.date });
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

// What the jobs will bring in and cost once they're finished: every accepted job's quote total against its materials and labour.
// (Labour already billed is the real figure; a job nobody has invoiced yet uses the quote's estimate.)
export function projectedOf(jobs) {
  const revenue = round2(jobs.reduce((s, j) => s + (j.quote ? Math.max(j.quotedTotal || 0, j.billed) : j.billed), 0));
  const cost = round2(jobs.reduce((s, j) => s + j.cost, 0));
  return { count: jobs.length, revenue, cost, profit: round2(revenue - cost), toCollect: round2(jobs.reduce((s, j) => s + j.owing, 0)) };
}
