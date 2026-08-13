// Shared table/column definitions for the server-side data API.
// No "use client" directive — safe to import only from API route handlers.
export const TABLE_COLUMNS = {
  leads: ["id", "name", "phone", "email", "address", "jobType", "status", "notes", "createdAt"],
  quotes: ["id", "docNumber", "clientName", "clientPhone", "address", "suburb", "jobType", "status", "date", "startDate", "validUntil", "depositPercent", "items", "notes", "distanceKm", "crew", "hours", "removalLength", "materialsCost", "jobLength", "fenceHeight", "materialsBreakdown", "acceptedAt", "acceptedByName"],
  invoices: ["id", "docNumber", "clientName", "address", "suburb", "jobType", "items", "status", "issuedDate", "dueDate", "paidDate", "notes", "quoteId"],
  materials: ["id", "name", "unit", "costPerUnit", "packQty", "qtyOnHand", "reorderLevel", "supplier"],
  expenses: ["id", "description", "category", "amount", "date"],
  settings: ["id", "consumption", "fuelPrice", "hourlyRate", "tipRatePerMetre", "nextDocNumber"],
};

export const JSONB_COLUMNS = new Set(["items", "materialsBreakdown"]);

export function sanitizeRow(table, row) {
  const cols = TABLE_COLUMNS[table] || [];
  const out = {};
  for (const c of cols) {
    let v = row[c];
    if (v === undefined) v = null;
    if (v !== null && c !== "id" && !JSONB_COLUMNS.has(c) && typeof v !== "string") {
      if (typeof v === "number" || typeof v === "boolean") v = String(v);
    }
    out[c] = v;
  }
  return out;
}
