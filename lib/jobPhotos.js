// Job photos (before / after / other) are kept in a private Supabase Storage bucket, one folder per quote: "<quoteId>/<kind>-<time>-<rand>.jpg".
// They never go through the data tables (so the hub's refresh stays light) and are only ever shown through short-lived signed links.
// The client's sign-off is one small System row in the expenses table, "signoff-<quoteId>". Server only.
export const BUCKET = "job-photos";
export const KINDS = ["before", "after", "other"];
export const SIGNOFF_PREFIX = "signoff-";

let ensured = false;
export async function ensureBucket(db) {
  if (ensured) return;
  const { error } = await db.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 6 * 1024 * 1024 });
  if (error && !/already exists|duplicate/i.test(error.message || "")) throw new Error(`photo storage: ${error.message}`);
  ensured = true;
}

const kindOf = (name) => KINDS.find((k) => String(name).startsWith(`${k}-`)) || "other";
const stampOf = (name) => Number(String(name).split("-")[1]) || 0;
export const safeId = (s) => String(s || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);

// -> [{ path, name, kind, at, url }] oldest first
export async function listPhotos(db, quoteId, { kinds = KINDS } = {}) {
  const id = safeId(quoteId);
  if (!id) return [];
  await ensureBucket(db);
  const { data, error } = await db.storage.from(BUCKET).list(id, { limit: 100 });
  if (error) throw new Error(`photo storage: ${error.message}`);
  const files = (data || []).filter((f) => f.name && !f.name.startsWith(".")).map((f) => ({ name: f.name, path: `${id}/${f.name}`, kind: kindOf(f.name), at: stampOf(f.name) })).filter((f) => kinds.includes(f.kind)).sort((a, b) => a.at - b.at);
  if (!files.length) return [];
  const { data: signed, error: e2 } = await db.storage.from(BUCKET).createSignedUrls(files.map((f) => f.path), 3600);
  if (e2) throw new Error(`photo storage: ${e2.message}`);
  const urls = new Map((signed || []).map((s) => [s.path, s.signedUrl]));
  return files.map((f) => ({ ...f, url: urls.get(f.path) || "" }));
}

export async function getSignoff(db, quoteId) {
  const { data } = await db.from("expenses").select("description").eq("id", `${SIGNOFF_PREFIX}${safeId(quoteId)}`).maybeSingle();
  try { const s = JSON.parse(data?.description || "null"); return s?.name ? s : null; } catch { return null; }
}
