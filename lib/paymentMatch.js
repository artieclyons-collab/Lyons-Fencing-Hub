// Matches money that came into your bank account to the invoices still unpaid, so you can tick them off in one go.
// A match needs the exact amount (the invoice total inc GST); the invoice number or the client's name in the bank description makes it surer.
// Pure functions: it only suggests, and nothing is marked paid until you confirm.
import { itemsTotal, gstBreakdown } from "./logic";

const invTotal = (i) => Math.round(gstBreakdown(itemsTotal(i.items)).total * 100) / 100;
const words = (s) => String(s || "").toLowerCase().match(/[a-z]{3,}/g) || [];
const STOP = new Set(["the", "and", "mrs", "ltd", "pty", "inc", "for", "from", "payment", "transfer", "deposit", "invoice", "direct", "credit", "osko", "payid", "bank", "fast", "internet", "banking", "received"]);

// -> { matches: [{ tx, invoice, score, confidence: "sure" | "likely" | "amount only", why }], unmatched: [tx], ambiguous: [{ tx, invoices }] }
export function matchPayments(txs, invoices) {
  const open = (invoices || []).filter((i) => i.status !== "Paid").map((i) => ({ i, total: invTotal(i) })).filter((x) => x.total > 0);
  const credits = (txs || []).filter((t) => t.amount > 0).sort((a, b) => a.date.localeCompare(b.date));
  const taken = new Set();
  const scored = [];
  for (const tx of credits) {
    const desc = String(tx.description || "").toLowerCase();
    const descNums = (desc.match(/lfs\s*-?\s*(\d+)/g) || []).map((s) => s.replace(/\D/g, ""));
    const cands = open.filter((x) => Math.abs(x.total - tx.amount) < 0.02).map((x) => {
      let score = 0;
      const why = [];
      const no = String(x.i.docNumber || "").match(/(\d+)/)?.[1];
      if (no && descNums.includes(no)) { score += 3; why.push(`the bank text has ${x.i.docNumber}`); }
      const nameWords = words(x.i.clientName).filter((w) => !STOP.has(w));
      const hit = nameWords.find((w) => desc.includes(w));
      if (hit) { score += 2; why.push(`the bank text has "${hit}"`); }
      if (x.i.issuedDate && tx.date >= String(x.i.issuedDate).slice(0, 10)) score += 1; // paid after it was issued
      else score -= 1;
      return { ...x, score, why };
    });
    scored.push({ tx, cands });
  }
  const out = { matches: [], unmatched: [], ambiguous: [] };
  // surest first, so an invoice is only ever matched once
  const ordered = scored.map((s) => ({ ...s, best: Math.max(-9, ...s.cands.map((c) => c.score)) })).sort((a, b) => b.best - a.best);
  for (const { tx, cands } of ordered) {
    const free = cands.filter((c) => !taken.has(c.i.id)).sort((a, b) => b.score - a.score);
    if (!free.length) { out.unmatched.push(tx); continue; }
    const top = free[0];
    const tied = free.filter((c) => c.score === top.score);
    if (tied.length > 1) { out.ambiguous.push({ tx, invoices: tied.map((c) => c.i) }); continue; }
    taken.add(top.i.id);
    out.matches.push({ tx, invoice: top.i, score: top.score, confidence: top.score >= 3 ? "sure" : top.score >= 2 ? "likely" : "amount only", why: top.why.join(", ") || "the amount matches exactly" });
  }
  out.matches.sort((a, b) => a.tx.date.localeCompare(b.tx.date));
  out.unmatched.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
