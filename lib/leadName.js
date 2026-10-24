// Leads often start with no name ("N/A", "Enquiry 0417 …") because the client hadn't given one yet. When a later text or email from
// that person introduces themselves ("it's Chen", "this is Chen", signing off "Thanks, Chen"), the placeholder is replaced.
// Only done for a lead whose name is a placeholder — a real name is never changed — and only on clear introductions.

export function isPlaceholderName(name) {
  const s = String(name || "").trim();
  if (!s) return true;
  return /^(?:n\/?a|nil|none|unknown|lead|client|customer|tbc|tba|new lead|no name|\(?no name\)?|\?+|-+|\.+)$/i.test(s) || /^enquiry\b/i.test(s);
}

// Words that follow "I'm" / "this is" / sign-offs but aren't names.
const NOT_NAMES = new Set(("a an the just looking after wondering hoping interested keen not so in from at here your getting enquiring inquiring contacting texting messaging calling chasing " +
  "needing wanting trying about with for one sorry good great available free ok okay yes no hi hey hello gday day can could would will do did need want wanted please and ive have hope was got " +
  "i we my our thanks thank mate artie lyons fencing fence home back out running there ready actually only now still going coming around late early on off up down sure fine well happy " +
  "glad afraid unable able someone calling texting regards cheers best kind many much very really super quite also too let lets let's the this that it is its it's all any some more " +
  "monday tuesday wednesday thursday friday saturday sunday today tomorrow tonight morning afternoon evening").split(/\s+/));

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const okWord = (w) => !!w && /^[A-Za-z]{2,15}$/.test(w) && !NOT_NAMES.has(w.toLowerCase());
const join = (a, b) => [a, okWord(b) && /^[A-Z]/.test(b) ? b : null].filter(Boolean).map(cap).join(" ");

// A name the writer gave for themselves, or null.
export function introducedName(text) {
  const t = String(text || "").replace(/[’‘ʼ]/g, "'").trim();
  if (!t) return null;
  // "my name is Chen", "name's Chen Wei" — explicit, so lower case is fine too.
  let m = /\b(?:my name(?:'s| is)|name's|name is)\s+([A-Za-z]{2,15})(?:\s+([A-Za-z]{2,15}))?/i.exec(t);
  if (m && okWord(m[1])) return join(m[1], m[2]);
  // "This is Chen" — with a capital ("this is great" isn't a name).
  m = /\bthis is\s+([A-Z][a-z]{1,14})(?:\s+([A-Z][a-z]{1,14}))?(?=[\s.,!]|$)/i.exec(t.replace(/\bthis is\b/gi, "this is"));
  if (m && /^[A-Z]/.test(m[1]) && okWord(m[1])) return join(m[1], m[2]);
  // "Chen here", "Hi Artie, Chen here"
  m = /(?:^|[\s,.!])([A-Z][a-z]{1,14})(?:\s+([A-Z][a-z]{1,14}))?\s+here\b/.exec(t);
  if (m && okWord(m[1])) return join(m[1], m[2]);
  // "It's Chen", "I'm Chen" — only when written with a capital, since "it's fine" / "I'm free" are everywhere.
  m = /\b(?:[Ii]t's|[Ii]ts|[Ii]'m|[Ii]m|[Ii] am)\s+([A-Z][a-z]{1,14})(?:\s+([A-Z][a-z]{1,14}))?(?=[\s.,!]|$)/.exec(t);
  if (m && okWord(m[1])) return join(m[1], m[2]);
  // Signed off: "Thanks, Chen" at the end of the message.
  m = /(?:thanks|thank you|cheers|regards|kind regards|many thanks|thanks again)[,.!\s]+([A-Z][a-z]{1,14})(?:\s+([A-Z][a-z]{1,14}))?\s*$/i.exec(t);
  if (m && okWord(m[1]) && /^[A-Z]/.test(m[1])) return join(m[1], m[2]);
  return null;
}

const tail = (s) => String(s || "").replace(/\D/g, "").slice(-9);
const lc = (s) => String(s || "").trim().toLowerCase();

// The same person's quotes (and the invoices made from them) that still carry the placeholder get the real name too.
export async function renameClient(supabase, lead, name) {
  const { data: quotes } = await supabase.from("quotes").select("id,clientName,clientPhone,clientEmail");
  const p = tail(lead.phone);
  const e = lc(lead.email);
  const mine = (quotes || []).filter((q) => isPlaceholderName(q.clientName) && ((p.length === 9 && tail(q.clientPhone) === p) || (e && lc(q.clientEmail) === e)));
  let n = 0;
  for (const q of mine) {
    const { error } = await supabase.from("quotes").update({ clientName: name }).eq("id", q.id);
    if (!error) n++;
  }
  if (mine.length) {
    const { data: invs } = await supabase.from("invoices").select("id,clientName,quoteId");
    const ids = new Set(mine.map((q) => q.id));
    for (const i of (invs || []).filter((i) => ids.has(i.quoteId) && isPlaceholderName(i.clientName))) {
      await supabase.from("invoices").update({ clientName: name }).eq("id", i.id);
    }
  }
  return n;
}
