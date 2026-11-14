// Profit by job, estimated from just three things: what the job is worth, the materials (the quote's "Calculate materials" figure, or the real
// supplier invoices once they've been added to the job) and the labour (Usher's invoices for the days he worked at that address; a job he
// hasn't invoiced yet uses the quote's own labour figure as a stand-in, marked as an estimate). Fuel, tipping and your own time aren't in it.
// Worked in ex GST terms: you charge GST on the job and claim it back on materials, so ex GST is what's really yours. Usher's invoices
// carry no GST. (Jobs come from buildJobs in lib/finances.js, which already ties invoices, labour days and supplier invoices to each job.)
const GST = 1.1;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function jobProfits(jobs) {
  return (jobs || [])
    .filter((j) => j.quote)
    .map((j) => {
      const priceInc = Math.max(j.quotedTotal || 0, j.billed || 0);
      const price = round2(priceInc / GST);
      const materials = round2((j.materials || 0) / GST);
      const labour = round2(j.labour || 0);
      const profit = round2(price - materials - labour);
      return {
        key: j.key, name: j.name, address: j.address, jobType: j.jobType || "Other", docNumber: j.docNumber, started: !!j.started, date: j.jobDate || "",
        price, materials, labour, profit, margin: price > 0 ? profit / price : null,
        materialsFrom: j.materialsActual ? "supplier invoices" : "calculated materials",
        labourFrom: j.labourLines?.length ? "Usher's invoices" : labour > 0 ? "estimate, not invoiced yet" : "none invoiced",
        labourIsEstimate: !j.labourLines?.length && labour > 0,
        // no materials figure at all (the job was quoted before "Calculate materials", say): the profit would look far too good, so it's left out of the totals
        incomplete: !(j.materials > 0),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function profitTotals(allRows) {
  const rows = allRows.filter((r) => !r.incomplete);
  const price = round2(rows.reduce((s, r) => s + r.price, 0));
  const materials = round2(rows.reduce((s, r) => s + r.materials, 0));
  const labour = round2(rows.reduce((s, r) => s + r.labour, 0));
  const profit = round2(price - materials - labour);
  return { price, materials, labour, profit, margin: price > 0 ? profit / price : null, count: rows.length, skipped: allRows.length - rows.length };
}

// average margin by job type, biggest first -> [{ type, count, price, profit, margin }]
export function profitByType(rows) {
  const by = new Map();
  for (const r of rows.filter((x) => !x.incomplete)) {
    const t = by.get(r.jobType) || { type: r.jobType, count: 0, price: 0, profit: 0 };
    t.count += 1; t.price += r.price; t.profit += r.profit;
    by.set(r.jobType, t);
  }
  return [...by.values()].map((t) => ({ ...t, margin: t.price > 0 ? t.profit / t.price : null })).sort((a, b) => b.price - a.price);
}
