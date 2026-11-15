// "Check before sending": things on a quote that look wrong or missing compared with what the client actually said (their lead notes) and
// what you usually charge. It only warns; it never changes the quote. Safe for the app screens and the server.
import { parseSiteJobs } from "./siteNotes";
import { ownNotes } from "./availability";
import { findColours } from "./colours";
import { quotesForLead } from "./quoteDecision";
import { itemsTotal } from "./logic";

const text = (it) => `${it.tpl || ""} ${it.desc || ""}`;
const isRemoval = (it) => /\bremov/i.test(String(it.desc || "").slice(0, 60)) || /removal/i.test(it.tpl || "");
const isGate = (it) => /\bgates?\b/i.test(text(it)) && !isRemoval(it);
const isFence = (it) => it.unit === "m" && !isRemoval(it) && !isGate(it) && /install|fence/i.test(text(it));
const r1 = (n) => Math.round(n * 10) / 10;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// the lead that goes with a quote (same phone, email or name)
export function leadForQuote(leads, quote) {
  const q = { name: quote.clientName, phone: quote.clientPhone, email: quote.clientEmail };
  return (leads || []).find((l) => quotesForLead([quote], l).length > 0) || null;
}

// -> [{ level: "warn" | "info", text }]
export function checkQuote(quote, { lead = null, quotes = [] } = {}) {
  const out = [];
  const items = quote.items || [];
  const fence = items.filter(isFence);
  const gateQty = items.filter(isGate).reduce((n, it) => n + (Number(it.qty) || 1), 0);
  const length = fence.reduce((n, it) => n + (Number(it.qty) || 0), 0);
  const hasRemoval = items.some(isRemoval);
  const hasVeg = items.some((it) => /vegetation|tree|prun/i.test(text(it)));

  if (items.length && !(itemsTotal(items) > 0)) out.push({ level: "warn", text: "The total is $0." });
  if (quote.status !== "Accepted" && !String(quote.clientEmail || "").trim() && !String(quote.clientPhone || "").trim()) out.push({ level: "warn", text: "There's no phone number or email on this quote, so there's no way to send or follow it up." });

  // against what the client said (only when the lead holds a single job: several paragraphs mean several quotes, which can't be compared one to one)
  const notes = lead ? ownNotes(lead.notes) : "";
  if (notes.trim()) {
    let drafts = [];
    try { drafts = parseSiteJobs(notes, { jobType: lead.jobType }).filter((d) => d.items.length > 0 && !d.service); } catch { drafts = []; }
    if (drafts.length === 1) {
      const d = drafts[0];
      const want = {
        length: d.items.filter(isFence).reduce((n, it) => n + (Number(it.qty) || 0), 0),
        gates: d.items.filter(isGate).reduce((n, it) => n + (Number(it.qty) || 1), 0),
        removal: d.items.some(isRemoval),
        veg: d.items.some((it) => /vegetation/i.test(text(it))),
      };
      // (a hipages enquiry only gives an estimated range of metres, never the real length, so it isn't compared)
      if (lead.source !== "hipages" && want.length > 0 && length > 0 && Math.abs(want.length - length) > 0.5) out.push({ level: "warn", text: `Their notes say ${r1(want.length)}m of fence but the quote has ${r1(length)}m.` });
      if (want.gates > 0 && gateQty === 0) out.push({ level: "warn", text: `Their notes mention ${want.gates === 1 ? "a gate" : `${want.gates} gates`} but the quote has none.` });
      if (want.removal && !hasRemoval) out.push({ level: "warn", text: "Their notes mention removing the old fence but the quote has no removal line." });
      if (want.veg && !hasVeg) out.push({ level: "warn", text: "Their notes mention a tree or bushes to remove but the quote has no line for it." });
    }
    const named = findColours(lead.notes);
    if (named.length === 1 && /colou?rbond/i.test(`${quote.jobType} ${fence.map(text).join(" ")}`)) {
      const onQuote = items.some((it) => new RegExp(`\\b${named[0]}\\b`, "i").test(it.desc || ""));
      if (!onQuote) out.push({ level: "info", text: `${named[0]} is in their notes but the quote doesn't say the colour.` });
    }
  }

  // against what you usually charge for the same kind of job
  // (plain fences only: a sleeper, raked, lapped or aluminium job is priced differently on purpose, so it isn't compared)
  const fancy = (list) => list.some((it) => /sleeper|rak(?:e|ed)|lapped|capped|good\s+neighbou?r|alumin|future\s+fence|slat/i.test(text(it)));
  const rates = fancy(fence) ? [] : quotes
    .filter((q) => q.id !== quote.id && q.status !== "Draft" && q.jobType === quote.jobType && !fancy((q.items || []).filter(isFence)))
    .map((q) => { const f = (q.items || []).filter(isFence); const len = f.reduce((n, it) => n + (Number(it.qty) || 0), 0); return len > 0 ? f.reduce((n, it) => n + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0) / len : 0; })
    .filter((x) => x > 0);
  if (rates.length >= 4 && length > 0) {
    const mine = fence.reduce((n, it) => n + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0) / length;
    const usual = median(rates);
    if (mine < usual * 0.8) out.push({ level: "info", text: `$${Math.round(mine)}/m for the fence is well under your usual $${Math.round(usual)}/m for ${quote.jobType}.` });
    else if (mine > usual * 1.3) out.push({ level: "info", text: `$${Math.round(mine)}/m for the fence is well over your usual $${Math.round(usual)}/m for ${quote.jobType}.` });
  }
  return out;
}
