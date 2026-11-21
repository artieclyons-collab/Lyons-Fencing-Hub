// Wording you keep changing on a job template: "Use this wording for future quotes" on a quote line saves what you wrote, and every new line from
// that template (inserted by hand, drafted from site notes or a photo, drafted from a client's message) uses it from then on. "Reset" brings the
// standard wording back. Each saved wording is one small System row in the expenses table, "tplwording-<label>" (no database change). Only the wording
// is kept, never the price (prices change from job to job). The templates in lib/constants.js are changed in place, so everything that reads them follows.
import { JOB_TEMPLATES } from "./constants";

export const WORDING_PREFIX = "tplwording-";
export const wordingId = (label) => WORDING_PREFIX + String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

const originals = new Map(); // label -> the standard wording, remembered the first time it's changed
const saved = new Map(); // label -> the wording in use now

// Make the templates follow the saved rows (expenses rows; anything else is ignored). Safe to call as often as you like.
export function applyTemplateWording(expenses) {
  const byId = new Map();
  for (const e of expenses || []) {
    if (!e || typeof e.id !== "string" || !e.id.startsWith(WORDING_PREFIX)) continue;
    try { const j = JSON.parse(e.description || "{}"); if (j && j.label && String(j.desc || "").trim()) byId.set(e.id, j); } catch { /* ignore a damaged row */ }
  }
  saved.clear();
  for (const t of JOB_TEMPLATES) {
    if (!originals.has(t.label)) originals.set(t.label, t.desc);
    const j = byId.get(wordingId(t.label));
    if (j && j.label === t.label) { saved.set(t.label, String(j.desc).trim()); t.desc = String(j.desc).trim(); }
    else t.desc = originals.get(t.label);
  }
}

export const standardWording = (label) => originals.get(label) ?? JOB_TEMPLATES.find((t) => t.label === label)?.desc ?? "";
export const hasSavedWording = (label) => saved.has(label);

// Server routes that draft quotes (the inbox reader, texts): follow the saved wording too. `db` is the Supabase admin client.
export async function loadTemplateWording(db) {
  try {
    const { data } = await db.from("expenses").select("id,description").like("id", `${WORDING_PREFIX}%`);
    applyTemplateWording(data || []);
  } catch { /* the standard wording is fine */ }
}

// The row to save for a template ("expenses" table shape)
export const wordingRow = (label, desc, dateIso) => ({ id: wordingId(label), category: "System", description: JSON.stringify({ label, desc: String(desc || "").trim() }), amount: "0", date: dateIso });

// Take effect straight away on this screen (the saved row follows in the database, and the next refresh re-reads it).
export function applyWordingNow(label, desc) {
  const t = JOB_TEMPLATES.find((x) => x.label === label);
  if (!t) return;
  if (!originals.has(label)) originals.set(label, t.desc);
  saved.set(label, String(desc).trim());
  t.desc = String(desc).trim();
}
export function resetWordingNow(label) {
  const t = JOB_TEMPLATES.find((x) => x.label === label);
  if (!t) return;
  saved.delete(label);
  if (originals.has(label)) t.desc = originals.get(label);
}
