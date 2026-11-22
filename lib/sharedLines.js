// One client, several quotes for the same job (Marcela: butted, Colorbond, lapped & capped): when you fix a line that is the same whatever the
// fence is made of (what's being removed, vegetation, delivery, anything you added by hand), the other quotes for that job should get the same fix,
// not a fresh default each time. Material-specific lines (the fence itself, the gate) are never copied across, because their price and wording
// depend on the material. Pure functions; the app decides when to use them (components/HubApp.jsx, in the quote save).
const uidDefault = () => Math.random().toString(36).slice(2, 10);

// templates whose line is the same whatever the new fence is made of
const SHARED_TPLS = new Set(["Timber fence removal", "Timber + chain wire fence removal", "Vegetation pruning/removal", "Material delivery", "Mini excavator/truck hire"]);
const isRemovalTpl = (t) => /fence removal$/.test(t || "");

// a line you typed in yourself (no template) counts as shared too, unless it is clearly about the fence material or a gate
export const isSharedLine = (it) => {
  if (!it) return false;
  if (it.tpl) return SHARED_TPLS.has(it.tpl);
  return !/\b(?:colou?rbond|timber|paling|lapped|butted|alumin\w*|slat|gate|post)\b/i.test(String(it.desc || ""));
};

const row = (it) => [it.tpl || "", String(it.desc || "").trim(), Number(it.qty) || 0, Number(it.rate) || 0, it.unit || ""];
// what the shared lines of a quote look like, to see whether you changed them
export const sharedKey = (items) => JSON.stringify((items || []).filter(isSharedLine).map(row));

// The quote's shared lines go into `target` (replacing its own shared lines): removal lines first, then the rest at the bottom, the way you build them.
export function applySharedLines(savedItems, targetItems, uid = uidDefault) {
  const src = (savedItems || []).filter(isSharedLine);
  const keep = (targetItems || []).filter((it) => !isSharedLine(it));
  const copy = (it) => ({ ...it, id: uid() });
  const top = src.filter((it) => isRemovalTpl(it.tpl) || /^removal and disposal of existing/i.test(String(it.desc || ""))).map(copy);
  const bottom = src.filter((it) => !top.some((t) => t.desc === it.desc && t.qty === it.qty && t.tpl === it.tpl)).map(copy);
  return [...top, ...keep, ...bottom];
}

// "…timber fence gate return at 1.8 metres…" typed on a short return section of one quote: the same section (same length) on another quote gets the same words.
export function applyReturnWording(savedItems, targetItems) {
  const said = [];
  for (const it of savedItems || []) {
    const m = /\bfence ((?:gate|fence) return) at\b/i.exec(String(it.desc || ""));
    if (m && !/\b(?:gate|fence) return\b/i.test(String(it.tpl || ""))) said.push({ qty: Number(it.qty) || 0, words: m[1] });
  }
  if (!said.length) return targetItems;
  return (targetItems || []).map((it) => {
    const s = said.find((x) => x.qty === (Number(it.qty) || 0));
    if (!s || it.unit !== "m" || /\b(?:gate|fence) return\b/i.test(String(it.desc || "")) || isSharedLine(it)) return it;
    return /\bfence at\b/.test(it.desc || "") ? { ...it, desc: it.desc.replace(/\bfence at\b/, `fence ${s.words} at`) } : it;
  });
}

// everything together: the target quote's items after taking on what you fixed in the saved one
export const carryAcross = (savedItems, targetItems, uid) => applyReturnWording(savedItems, applySharedLines(savedItems, targetItems, uid));

// Other quotes for the same job: still Draft, same client (same phone, or the same name when a phone is missing), made the same day.
const tail = (s) => String(s || "").replace(/\D/g, "").slice(-9);
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function sameJobDrafts(quote, quotes) {
  const p = tail(quote.clientPhone), n = norm(quote.clientName);
  return (quotes || []).filter((q) => q.id !== quote.id && q.status === "Draft" && String(q.date || "") === String(quote.date || "") && ((p.length === 9 && tail(q.clientPhone) === p) || (n && norm(q.clientName) === n && (!p || !tail(q.clientPhone)))));
}
