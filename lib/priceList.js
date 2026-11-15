// Lines read off a supplier price list (name, unit, price) matched to the materials you already have, so prices can be updated in one go.
// Pure functions (the reading itself is app/api/ai/read-pricelist). A match is a suggestion: you can change which material a line is for, and
// nothing is saved until you apply it.
const SYN = [[/colou?rbond/g, "cb"], [/\bcolorbond\b/g, "cb"], [/\bsawscreen\b/g, "sheet"], [/\bscreen\b/g, "sheet"], [/\bpaling\b/g, "paling"], [/\bmetres?\b/g, "m"], [/\bmm\b/g, "mm"]];
const STOP = new Set(["each", "ea", "pack", "pk", "box", "the", "and", "for", "with", "inc", "gst", "ex", "per", "mo", "monument", "colour", "color"]);

export function tokens(name) {
  let s = String(name || "").toLowerCase().replace(/[()\[\],/\\:;'"]/g, " ").replace(/[-_]/g, " ");
  for (const [re, to] of SYN) s = s.replace(re, to);
  return [...new Set(s.split(/\s+/).filter((t) => t && !STOP.has(t) && !/^\(\d+\)$/.test(t)))];
}
const isSize = (t) => /\d/.test(t); // 2.7h, 2365w, 300mm, 1.8h, 16mm: the part that tells two similar items apart

function score(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const t of A) if (B.has(t)) both++;
  const jac = both / (A.size + B.size - both);
  // sizes must agree: "post 2.7h" is not "post 2.4h"
  const sa = a.filter(isSize), sb = b.filter(isSize);
  const sizeClash = sa.length && sb.length && !sa.some((t) => sb.includes(t));
  return sizeClash ? jac * 0.3 : jac;
}

// items: [{ name, unit, price }]  materials: your Materials rows  -> [{ item, material | null, score, oldPrice, newPrice, changePct }]
export function matchPriceList(items, materials, { exGst = false } = {}) {
  const mats = (materials || []).map((m) => ({ m, t: tokens(m.name) }));
  return (items || []).map((item) => {
    const t = tokens(item.name);
    let best = null, bestScore = 0;
    for (const x of mats) { const sc = score(t, x.t); if (sc > bestScore) { bestScore = sc; best = x.m; } }
    const price = Math.round(Number(item.price) * (exGst ? 1.1 : 1) * 100) / 100;
    const ok = best && bestScore >= 0.45;
    const oldPrice = ok ? Number(best.costPerUnit) || 0 : null;
    return { item, material: ok ? best : null, score: bestScore, oldPrice, newPrice: price, changePct: ok && oldPrice > 0 ? Math.round(((price - oldPrice) / oldPrice) * 1000) / 10 : null };
  });
}
