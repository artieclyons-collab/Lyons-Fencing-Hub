// Plain-text search for the quote, invoice and lead lists. Every word you type has to appear somewhere in
// the record (name, number, address, notes, line items, status, phone, amounts...), in any order.
import { gstBreakdown, itemsTotal } from "./logic";
import { isDepositInvoice } from "./logic";

const money = (n) => {
  const v = Number(n) || 0;
  return `${v.toFixed(2)} ${v.toFixed(0)} ${v.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const digits = (s) => String(s || "").replace(/\D/g, "");
const itemText = (items) => (items || []).map((it) => it.desc || "").join(" ");

export const quoteText = (q) =>
  [q.clientName, q.docNumber, q.address, q.suburb, q.jobType, q.status, q.notes, q.clientPhone, digits(q.clientPhone),
    itemText(q.items), money(gstBreakdown(itemsTotal(q.items)).total), money(itemsTotal(q.items))].join(" ");

export const invoiceText = (i) =>
  [i.clientName, i.docNumber, i.address, i.suburb, i.jobType, i.status, i.notes, isDepositInvoice(i) ? "deposit" : "",
    itemText(i.items), money(gstBreakdown(itemsTotal(i.items)).total), money(itemsTotal(i.items))].join(" ");

export const leadText = (l) =>
  [l.name, l.address, l.jobType, l.status, l.notes, l.email, l.phone, digits(l.phone),
    l.source === "phone_agent" ? "phone agent" : ""].join(" ");

// "linda  burleigh" -> both words must be present. Empty search matches everything.
export function matchesQuery(text, query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = String(text).toLowerCase();
  return words.every((w) => hay.includes(w));
}
