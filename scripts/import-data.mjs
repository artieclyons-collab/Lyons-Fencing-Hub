// One-off import: loads a lyons-fencing-hub export JSON into Supabase.
//
// Usage:
//   node scripts/import-data.mjs path/to/lyons-fencing-hub-export-YYYY-MM-DD.json
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local
// (or the environment) — with RLS on, the service role key is required; the
// anon key can no longer write. Safe to re-run: rows are upserted by id, so
// running it twice won't duplicate anything.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

// --- tiny .env.local loader (no extra dependency) ---
function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — set them in .env.local first.");
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/import-data.mjs <export-file.json>");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const supabase = createClient(url, key);

const uid = () => Math.random().toString(36).slice(2, 10);

const COLUMNS = {
  leads: ["id", "name", "phone", "email", "address", "jobType", "status", "notes", "createdAt"],
  quotes: ["id", "docNumber", "clientName", "clientPhone", "address", "suburb", "jobType", "status", "date", "startDate", "validUntil", "depositPercent", "items", "notes", "distanceKm", "crew", "hours", "removalLength", "materialsCost", "jobLength", "fenceHeight", "materialsBreakdown", "acceptedAt", "acceptedByName"],
  invoices: ["id", "docNumber", "clientName", "address", "suburb", "jobType", "items", "status", "issuedDate", "dueDate", "paidDate", "notes", "quoteId"],
  materials: ["id", "name", "unit", "costPerUnit", "packQty", "qtyOnHand", "reorderLevel", "supplier"],
  expenses: ["id", "description", "category", "amount", "date"],
};
const JSONB = new Set(["items", "materialsBreakdown"]);

function sanitize(table, row) {
  const out = {};
  for (const c of COLUMNS[table]) {
    let v = row[c];
    if (v === undefined) v = null;
    if (v !== null && c !== "id" && !JSONB.has(c) && typeof v !== "string") v = String(v);
    out[c] = v;
  }
  if (!out.id) out.id = uid();
  return out;
}

async function importTable(table) {
  const list = raw[table] || [];
  if (list.length === 0) {
    console.log(`${table}: nothing to import`);
    return;
  }
  // The app orders by inserted_at desc; the export arrays are newest-first,
  // so stagger timestamps to preserve the original order.
  const base = Date.now();
  const rows = list.map((r, i) => ({
    ...sanitize(table, r),
    inserted_at: new Date(base - i * 1000).toISOString(),
  }));
  const { error } = await supabase.from(table).upsert(rows);
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`${table}: imported ${rows.length} row(s)`);
}

async function importSettings() {
  const s = raw.settings;
  if (!s) {
    console.log("settings: nothing to import");
    return;
  }
  const row = { id: "1" };
  for (const c of ["consumption", "fuelPrice", "hourlyRate", "tipRatePerMetre", "nextDocNumber"]) {
    row[c] = s[c] === undefined || s[c] === null ? null : String(s[c]);
  }
  const { error } = await supabase.from("settings").upsert(row);
  if (error) throw new Error(`settings: ${error.message}`);
  console.log("settings: imported");
}

try {
  console.log(`Importing from ${file} into ${url} ...`);
  await importTable("leads");
  await importTable("quotes");
  await importTable("invoices");
  await importTable("materials");
  await importTable("expenses");
  await importSettings();
  console.log("\nDone — open the app and everything should be there.");
} catch (e) {
  console.error("\nImport failed:", e.message);
  console.error("If the tables don't exist yet, run supabase/schema.sql in the Supabase SQL Editor first.");
  process.exit(1);
}
