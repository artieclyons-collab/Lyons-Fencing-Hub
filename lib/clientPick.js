// "Fill in from an existing client": everyone the hub knows about (leads, quotes, invoices) as one list of people, with their name, phone, email,
// street address, suburb and who the paperwork is made out to, so a new quote or invoice can be filled in with one tap.
import { splitAddress } from "./leadToQuote";
import { getBillTo } from "./billTo";

const tail9 = (s) => String(s || "").replace(/\D/g, "").slice(-9);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (s) => String(s ?? "").trim();

// -> [{ key, name, sub, from: ["Lead", "Quote"], fields: { clientName, clientPhone, clientEmail, address, suburb, billName } }]
export function clientOptions({ leads = [], quotes = [], invoices = [] }) {
  const byKey = new Map();
  const add = (from, f) => {
    if (!clean(f.clientName)) return;
    const p = tail9(f.clientPhone);
    let key = p.length === 9 ? `p${p}` : clean(f.clientEmail) ? `e${clean(f.clientEmail).toLowerCase()}` : `n${norm(f.clientName)}`;
    // an entry with no phone (an invoice) joins the person it's clearly about: the same email, or the same name
    if (!byKey.has(key)) {
      const e = clean(f.clientEmail).toLowerCase();
      const same = [...byKey.values()].find((o) => (e && clean(o.fields.clientEmail).toLowerCase() === e) || norm(o.fields.clientName) === norm(f.clientName));
      if (same) key = same.key;
    }
    const cur = byKey.get(key) || { key, from: [], fields: {} };
    if (!cur.from.includes(from)) cur.from.push(from);
    for (const [k, v] of Object.entries(f)) if (!clean(cur.fields[k]) && clean(v)) cur.fields[k] = clean(v); // the first (newest / most reliable) value wins
    byKey.set(key, cur);
  };
  for (const l of leads) {
    const a = splitAddress(l.address);
    add("Lead", { clientName: l.name, clientPhone: l.phone, clientEmail: l.email, address: a.address || l.address, suburb: a.suburb, billName: getBillTo(l.notes) });
  }
  const newest = (a, b) => String(b.date || b.issuedDate || "").localeCompare(String(a.date || a.issuedDate || ""));
  for (const q of [...quotes].sort(newest)) add("Quote", { clientName: q.clientName, clientPhone: q.clientPhone, clientEmail: q.clientEmail, address: q.address, suburb: q.suburb, billName: q.billName });
  for (const i of [...invoices].sort(newest)) add("Invoice", { clientName: i.clientName, clientEmail: i.clientEmail, address: i.address, suburb: i.suburb, billName: i.billName });
  return [...byKey.values()]
    .map((o) => ({ ...o, name: o.fields.clientName, sub: [[o.fields.address, o.fields.suburb].filter(Boolean).join(", "), o.fields.clientPhone || o.fields.clientEmail].filter(Boolean).join(" · ") }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// the people matching what's typed (every word has to be in their name, address, phone or email)
export function searchClients(options, query, limit = 8) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return options
    .filter((o) => {
      const hay = `${o.name} ${o.sub} ${o.fields.clientEmail || ""} ${String(o.fields.clientPhone || "").replace(/\D/g, "")} ${o.fields.billName || ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}
