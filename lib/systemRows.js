// Small bookkeeping rows the hub keeps in the expenses table (category "System") so they need no database change.
// "sys-text-in": when the iPhone Shortcut last got a text through to /api/leads/inbound-text, and when one last arrived empty.
export const SYSTEM_CATEGORY = "System";
export const TEXT_IN_ID = "sys-text-in";
export const isSystemRow = (r) => !!r && r.category === SYSTEM_CATEGORY;

// -> { last: ISO | "", empty: ISO | "", count } from the expenses rows
export function textLinkStatus(expenses) {
  const row = (expenses || []).find((r) => r && r.id === TEXT_IN_ID);
  if (!row) return { last: "", empty: "", count: 0 };
  try {
    const s = JSON.parse(row.description);
    return { last: s.last || "", empty: s.empty || "", count: Number(s.n) || 0 };
  } catch {
    return { last: "", empty: "", count: 0 };
  }
}
