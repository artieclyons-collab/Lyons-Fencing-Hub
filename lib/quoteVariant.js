// "The same job in Colorbond" (or timber): builds a new draft from an existing quote by writing its facts back out as site notes
// (lengths, heights, raked, sleepers, old-fence removal, gates) in the other material and running them through the normal quote builder,
// so the new quote gets that material's own templates, rates, wording and notes. The client, address and billing details carry over.
// Safe for the app screens and the server (no server-only imports).
import { quotesFromLead } from "./leadToQuote";

const text = (it) => `${it.tpl || ""} ${it.desc || ""}`;
const isRemoval = (it) => /\bremov/i.test(String(it.desc || "").slice(0, 60)) || /removal/i.test(it.tpl || "");
const isGate = (it) => /\bgates?\b/i.test(text(it)) && !/\bremov|rehang|re-hang/i.test(String(it.desc || "").slice(0, 60));
const isInstall = (it) => it.unit === "m" && !isRemoval(it) && !isGate(it) && /install|fence/i.test(text(it));

const heightOf = (it) => {
  const d = /\bat\s+(\d(?:\.\d+)?)\s*(?:metres?|m)\s+high/i.exec(it.desc || "");
  if (d) return d[1];
  const t = /(\d(?:\.\d+)?)m\s*$/i.exec(String(it.tpl || "").trim());
  return t ? t[1] : "1.8";
};

export const STYLES = {
  Colorbond: { word: "colorbond", label: "Colorbond" },
  "Timber fencing": { word: "butted timber", label: "timber" },
};
export const jobTypeOfQuote = (q) => (/colou?rbond/i.test(`${q.jobType || ""} ${(q.items || []).filter(isInstall).map(text).join(" ")}`) ? "Colorbond" : /alumin/i.test(q.jobType || "") ? "Aluminium fencing" : "Timber fencing");

// -> a new quote (fields to save as a Draft) in `target` ("Colorbond" | "Timber fencing"), or null when the quote has no fence to convert
export function variantFromQuote(q, target) {
  const style = STYLES[target];
  if (!style) return null;
  const items = q.items || [];
  const installs = items.filter(isInstall);
  if (!installs.length) return null;

  // one line per distinct (height, raked, sleeper) so a quote with a 1.8m side and a 2.1m front stays two lines
  const groups = new Map();
  for (const it of installs) {
    const raked = /\brak(?:e|ed|ing)\b/i.test(text(it));
    const sleeper = /sleepers?/i.test(text(it));
    const h = sleeper ? "2" : heightOf(it);
    const k = `${h}|${raked}|${sleeper}`;
    const g = groups.get(k) || { h, raked, sleeper, len: 0 };
    g.len += Number(it.qty) || 0;
    groups.set(k, g);
  }
  const removal = items.some(isRemoval);
  const lines = [...groups.values()].map((g) => `${Math.round(g.len * 100) / 100}m ${g.sleeper ? "" : `${g.h} `}${style.word}${g.raked ? " raked" : ""}${g.sleeper ? " w sleeper 2m" : ""}${removal ? " inc removal" : " no removal"}`.replace(/\s+/g, " "));
  const gates = items.filter(isGate).reduce((n, it) => n + (Number(it.qty) || 1), 0);
  if (gates > 0) lines.push(`${gates} gate${items.filter(isGate).some((it) => /driveway|double|wide/i.test(text(it))) ? " driveway" : ""}`);

  const drafts = quotesFromLead({
    id: q.id,
    name: q.clientName,
    phone: q.clientPhone,
    email: q.clientEmail,
    address: [q.address, q.suburb].filter(Boolean).join(", "),
    jobType: target,
    notes: lines.join("\n"),
  });
  const d = drafts[0];
  if (!d || !(d.items || []).length) return null;
  const { _fromLeadId, _draft, _batch, ...rest } = d;
  return {
    ...rest,
    jobType: target,
    clientName: q.clientName,
    clientPhone: q.clientPhone || "",
    clientEmail: q.clientEmail || "",
    address: q.address || rest.address,
    suburb: q.suburb || rest.suburb,
    billName: q.billName || rest.billName || "",
    title: q.title || "",
    status: "Draft",
    summary: lines.join("; "),
  };
}
