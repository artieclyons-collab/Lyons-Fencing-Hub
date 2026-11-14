// Three small "keep on top of it" lists for the Board and Finances:
//  - Colorbond jobs that are about to start with no colour confirmed
//  - the 24-month warranty on finished jobs (who's coming up, so you can check in before it ends)
//  - where leads come from (hipages, text, email) and what each source turns into
// Nothing here needs a database column: a confirmed colour is a small System row in the expenses table (id "col-<quoteId>", the colour
// as its description) and a cost per lead is the System row "sys-leadcost". Pure functions, so they're easy to test.
import { itemsTotal, gstBreakdown, isDepositInvoice } from "./logic";
import { isIsoDate } from "./jobSchedule";
import { quotesForLead } from "./quoteDecision";

export const WARRANTY_MONTHS = 24;
export const COLOUR_SOON_DAYS = 14; // warn when a Colorbond job starts within this many days (red inside 7)
export const WARRANTY_SOON_DAYS = 60; // "coming up" window
export const COLOUR_PREFIX = "col-";
export const LEAD_COST_ID = "sys-leadcost";

const incTotal = (items) => gstBreakdown(itemsTotal(items)).total;
const dayMs = 86400000;
const toMs = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
const daysBetween = (fromIso, toIso) => Math.round((toMs(toIso) - toMs(fromIso)) / dayMs);

// "2026-11-14" + 24 months = "2028-11-14" (the 31st rolls back to the end of a shorter month)
export function addMonthsIso(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

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

// Finished jobs and when their warranty ends -> [{ key, name, address, phone, finished, ends, daysLeft, quoteId }], ending soonest first.
// Finished = the date the final invoice was issued. Jobs whose warranty ended more than a month ago are left out.
export function warrantyList(quotes, invoices, todayIso) {
  const done = finalInvoiceByQuote(invoices);
  const byId = new Map((quotes || []).map((q) => [q.id, q]));
  const seen = new Set();
  const out = [];
  for (const [quoteId, inv] of done) {
    const q = byId.get(quoteId);
    const name = String(q?.clientName || inv.clientName || "").trim();
    const address = String(q?.address || inv.address || "").trim();
    const ends = addMonthsIso(inv.issuedDate, WARRANTY_MONTHS);
    const daysLeft = daysBetween(todayIso, ends);
    if (daysLeft < -30) continue;
    // one line per client and address, so a job with a split invoice or two quotes isn't listed twice
    const k = `${name.toLowerCase()}|${address.toLowerCase()}|${ends}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: quoteId, name: name || "Client", address, phone: q?.clientPhone || "", finished: inv.issuedDate, ends, daysLeft, quoteId });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
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

