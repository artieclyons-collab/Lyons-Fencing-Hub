// Has Usher's invoice for THIS working week already been made out? Used by the Sunday reminder so it only nags when it hasn't.
// The week runs Monday to Sunday. An invoice covers the week if any day on it falls in that week (an invoice made out the following Monday
// for last week's days doesn't count). An invoice with no days we can read counts if it's dated this week.
// rows: the "Labour invoice" rows from the expenses table (description is the invoice as JSON, date is the invoice date).
const toMs = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// the Monday of the week that contains `todayIso`
export const weekStartOf = (todayIso) => iso(toMs(todayIso) - ((new Date(toMs(todayIso)).getUTCDay() + 6) % 7) * 86400000);

export function invoicedThisWeek(rows, todayIso) {
  const start = weekStartOf(todayIso);
  for (const r of rows || []) {
    let days = [];
    try { days = (JSON.parse(r.description || "{}").days || []).map((d) => String(d.date || "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)); } catch { days = []; }
    if (days.length ? days.some((d) => d >= start && d <= todayIso) : String(r.date || "").slice(0, 10) >= start) return true;
  }
  return false;
}
