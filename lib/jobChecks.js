// Small "keep on top of it" lists for the Board and Finances:
//  - Colorbond jobs that are about to start with no colour confirmed
//  - where leads come from (hipages, text, email) and what each source turns into
// Nothing here needs a database column: a confirmed colour is a small System row in the expenses table (id "col-<quoteId>", the colour
// as its description) and a cost per lead is the System row "sys-leadcost". Pure functions, so they're easy to test.
import { itemsTotal, gstBreakdown, isDepositInvoice } from "./logic";
import { isIsoDate } from "./jobSchedule";
import { quotesForLead } from "./quoteDecision";

export const COLOUR_SOON_DAYS = 14; // warn when a Colorbond job starts within this many days (red inside 7)
export const COLOUR_PREFIX = "col-";
export const LEAD_COST_ID = "sys-leadcost";

const incTotal = (items) => gstBreakdown(itemsTotal(items)).total;
const dayMs = 86400000;
const toMs = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
const daysBetween = (fromIso, toIso) => Math.round((toMs(toIso) - toMs(fromIso)) / dayMs);

export const isColorbondQuote = (q) => /colou?rbond/i.test(`${q?.jobType || ""} ${(q?.items || []).map((i) => i.desc || "").join(" ")}`);

// the confirmed colours: { [quoteId]: "Monument" }
export function colourMap(expenses) {
  const out = {};
  for (const e of expenses || []) if (e && typeof e.id === "string" && e.id.startsWith(COLOUR_PREFIX) && String(e.description || "").trim()) out[e.id.slice(COLOUR_PREFIX.length)] = String(e.description).trim();
  return out;
}

// A job counts as finished once its final (not deposit) invoice has gone out. -> Map of quoteId -> latest final invoice
function finalInvoiceByQuote(invoices) {
  const m = new Map();
  for (const i of invoices || []) {
    if (!i.quoteId || isDepositInvoice(i) || !isIsoDate(i.issuedDate)) continue;
    const cur = m.get(i.quoteId);
    if (!cur || i.issuedDate > cur.issuedDate) m.set(i.quoteId, i);
  }
  return m;
}

// Accepted Colorbond jobs that haven't finished and start soon (or have started) -> [{ quote, colour, days, urgent }], soonest first.
// `days` is how many days until the start (negative once it's started).
export function colourChecks(quotes, invoices, colours, todayIso) {
  const done = finalInvoiceByQuote(invoices);
  const out = [];
  for (const q of quotes || []) {
    if (q.status !== "Accepted" || !isColorbondQuote(q) || done.has(q.id) || !isIsoDate(q.startDate)) continue;
    const days = daysBetween(todayIso, q.startDate);
    const colour = colours?.[q.id] || "";
    if (days > COLOUR_SOON_DAYS && !colour) continue; // too far off to nag about
    if (days < -21) continue; // long underway, not a reminder any more
    out.push({ quote: q, colour, days, urgent: !colour && days <= 7 });
  }
  return out.sort((a, b) => a.days - b.days);
}

export function leadCosts(expenses) {
  const row = (expenses || []).find((e) => e.id === LEAD_COST_ID);
  try { return JSON.parse(row?.description || "{}") || {}; } catch { return {}; }
}

export const sourceOf = (lead) => {
  const s = String(lead?.source || "").trim().toLowerCase();
  if (!s) return "other";
  if (/hipages/.test(s)) return "hipages";
  if (/text|sms/.test(s)) return "text";
  if (/mail/.test(s)) return "email";
  return s;
};

// Where leads come from and what they become -> [{ source, leads, quoted, won, revenue, cost, perLead, perWin }]
// A lead is "quoted" if its client has a quote that went out (Sent / Accepted), "won" if one was accepted. Revenue is the accepted
// quotes' totals inc. GST, counted once per client (so two leads from one client don't double up).
export function leadSourceStats(leads, quotes, costs = {}) {
  const rows = new Map();
  const counted = new Set();
  for (const l of leads || []) {
    const src = sourceOf(l);
    const r = rows.get(src) || { source: src, leads: 0, quoted: 0, won: 0, revenue: 0 };
    r.leads += 1;
    const mine = quotesForLead(quotes || [], l).filter((q) => q.status === "Sent" || q.status === "Accepted");
    if (mine.length || l.status === "Quoted" || l.status === "Won") r.quoted += 1;
    const accepted = mine.filter((q) => q.status === "Accepted");
    if (accepted.length || l.status === "Won") {
      r.won += 1;
      for (const q of accepted) {
        if (counted.has(q.id)) continue;
        counted.add(q.id);
        r.revenue += incTotal(q.items);
      }
    }
    rows.set(src, r);
  }
  return [...rows.values()]
    .map((r) => {
      const perLead = Number(costs[r.source]) || 0;
      const cost = perLead * r.leads;
      return { ...r, cost, perLead, perWin: r.won && cost ? cost / r.won : 0 };
    })
    .sort((a, b) => b.leads - a.leads);
}

