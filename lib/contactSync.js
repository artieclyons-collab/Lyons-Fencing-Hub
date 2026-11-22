// Type a client's email (or phone) once and it goes everywhere it belongs: their other quotes, their invoices and their lead.
// Records are grouped as the same client when they share a phone number, an email address, or the same name at the same street address
// (an invoice also joins the quote it was made from when the names match). Within a group, a BLANK email or phone is filled in only when
// the group has exactly one email (or phone) in it, so two different people sharing a phone number, or a name, are never mixed up and nothing
// that's already filled in is ever changed. Pure: the app applies the result. (Used by HubApp; also fine on the server.)
const tail = (s) => String(s || "").replace(/\D/g, "").slice(-9);
const lc = (s) => String(s || "").trim().toLowerCase();
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const validEmail = (s) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(String(s || "").trim());
// "10 Jasper Court Currumbin Waters" and "10 Jasper Court" are the same place: the number and the first street word are the key
const streetKey = (a) => { const t = String(a || "").toLowerCase().match(/[a-z0-9]+/g) || []; return t.length >= 2 && /^\d/.test(t[0]) ? `${t[0]} ${t[1]}` : ""; };

// each kind says where its fields live
const KINDS = {
  quote: { name: "clientName", phone: "clientPhone", email: "clientEmail", address: "address" },
  invoice: { name: "clientName", phone: null, email: "clientEmail", address: "address" }, // (invoices have no phone column)
  lead: { name: "name", phone: "phone", email: "email", address: "address" },
};

// lists: { quotes, leads, invoices } -> { quotes, leads, invoices, changed } (the same arrays back when nothing needed filling)
export function syncContacts({ quotes = [], leads = [], invoices = [] }) {
  const recs = [];
  for (const [kind, list] of [["quote", quotes], ["invoice", invoices], ["lead", leads]]) list.forEach((row, i) => recs.push({ kind, i, row, f: KINDS[kind] }));
  const parent = recs.map((_, k) => k);
  const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const byKey = new Map();
  const link = (key, k) => { if (byKey.has(key)) join(byKey.get(key), k); else byKey.set(key, k); };
  const quoteIdx = new Map();
  recs.forEach((r, k) => {
    const { row, f } = r;
    const p = f.phone ? tail(row[f.phone]) : "";
    if (p.length === 9) link(`p:${p}`, k);
    const e = lc(row[f.email]);
    if (validEmail(e)) link(`e:${e}`, k);
    const sk = streetKey(row[f.address]), nm = norm(row[f.name]);
    if (sk && nm) link(`n:${nm}|${sk}`, k);
    if (r.kind === "quote" && row.id) quoteIdx.set(row.id, k);
  });
  // an invoice belongs with the quote it was made from, when it is for the same person (a neighbour's invoice shares the quote but not the name)
  recs.forEach((r, k) => {
    if (r.kind !== "invoice" || !r.row.quoteId || !quoteIdx.has(r.row.quoteId)) return;
    const q = recs[quoteIdx.get(r.row.quoteId)];
    if (norm(q.row.clientName) && norm(q.row.clientName) === norm(r.row.clientName)) join(quoteIdx.get(r.row.quoteId), k);
  });
  const groups = new Map();
  recs.forEach((r, k) => { const g = find(k); (groups.get(g) || groups.set(g, []).get(g)).push(r); });

  const out = { quotes: quotes.slice(), leads: leads.slice(), invoices: invoices.slice() };
  const listOf = { quote: "quotes", invoice: "invoices", lead: "leads" };
  const touched = new Set();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const emails = new Set(members.map((m) => lc(m.row[m.f.email])).filter(validEmail));
    const phones = new Set(members.filter((m) => m.f.phone).map((m) => tail(m.row[m.f.phone])).filter((p) => p.length === 9));
    const email = emails.size === 1 ? [...emails][0] : "";
    // keep the way the phone was written (the first one in the group that has it), not just its digits
    const phoneRaw = phones.size === 1 ? members.filter((m) => m.f.phone).map((m) => String(m.row[m.f.phone] || "").trim()).find((v) => tail(v).length === 9) : "";
    for (const m of members) {
      const patch = {};
      if (email && !validEmail(m.row[m.f.email])) patch[m.f.email] = email;
      if (phoneRaw && m.f.phone && tail(m.row[m.f.phone]).length < 9) patch[m.f.phone] = phoneRaw;
      if (Object.keys(patch).length) { out[listOf[m.kind]][m.i] = { ...m.row, ...patch }; touched.add(listOf[m.kind]); }
    }
  }
  return { quotes: touched.has("quotes") ? out.quotes : quotes, leads: touched.has("leads") ? out.leads : leads, invoices: touched.has("invoices") ? out.invoices : invoices, changed: touched.size > 0 };
}
