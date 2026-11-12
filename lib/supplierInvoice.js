// Supplier invoices (Our Town, Bunnings...) kept in the hub, so a job's materials cost is what was really paid, not an estimate.
// Like the labourer invoices they're rows in the existing expenses table (category "Supplier invoice", the details as JSON), which
// needs no database change.
export const SUPPLIER_CATEGORY = "Supplier invoice";
export const isSupplierRow = (r) => !!r && r.category === SUPPLIER_CATEGORY;

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);

// The same invoice added twice lands on the same id (and so replaces itself); one with no number gets a fresh id.
export const supplierId = (doc) => (doc.invoiceNumber ? `sup-${slug(doc.supplier)}-${slug(doc.invoiceNumber)}` : `sup-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);

// doc: { supplier, invoiceNumber, date, deliveryAddress, deliveryIncGst, lines, totalIncGst, quoteId }
export function supplierRow(doc, id = supplierId(doc)) {
  const slim = {
    v: 1, supplier: doc.supplier || "", number: doc.invoiceNumber || "", date: doc.date || "", address: doc.deliveryAddress || "", quoteId: doc.quoteId || "",
    delivery: Number(doc.deliveryIncGst) || 0, lines: (doc.lines || []).map((l) => ({ desc: l.desc, qty: l.qty, total: Number(l.totalIncGst ?? l.total) || 0 })),
  };
  return { id, category: SUPPLIER_CATEGORY, description: JSON.stringify(slim), amount: String(Number(doc.totalIncGst) || 0), date: doc.date || new Date().toISOString().slice(0, 10) };
}

// -> { id, supplier, number, date, address, quoteId, delivery, lines, total } or null
export function supplierFromRow(row) {
  try {
    const d = JSON.parse(row.description);
    if (!d || !Array.isArray(d.lines)) return null;
    return { ...d, id: row.id, total: Number(row.amount) || 0, date: d.date || row.date || "" };
  } catch {
    return null;
  }
}

export const supplierInvoices = (rows) => (rows || []).filter(isSupplierRow).map(supplierFromRow).filter(Boolean);

// Supplier invoices read from email that are waiting for you to check them (see lib/supplierMail.js): rows in the expenses table,
// category "System" (so they stay out of your expense list), id "pend-…". -> { id, from, subject, file, receivedAt, doc } or null
export const isPendingRow = (r) => !!r && r.category === "System" && String(r.id || "").startsWith("pend-");
export function pendingFromRow(row) {
  try {
    const d = JSON.parse(row.description);
    return d && d.doc ? { ...d, id: row.id } : null;
  } catch {
    return null;
  }
}
