// The cash price offered when a client asks for one: about 10% off the total (inc GST), rounded DOWN to the nearest $50, so it lands on a
// nice round number (a $8,640 job -> $7,750 is more than 10% off; $8,700 -> $7,800). The offer that was actually emailed is kept in a small
// System row in the expenses table (id "cash-<quoteId>", the price as its description) so nothing needs a database change, and the quote editor's
// "Apply cash price" button uses it. GST is charged on what's really paid, so the discount is taken off as a negative line and the total is
// exactly the cash price. Pure functions (the email box and the quote editor both import this).
import { itemsTotal, gstBreakdown, money } from "./logic";

export const CASH_PREFIX = "cash-";
export const CASH_PERCENT = 10;
export const CASH_STEP = 50;
export const CASH_LINE = "Cash payment discount";
export const CASH_MIN_PERCENT = 3; // an offer smaller than this isn't really a discount, and bigger than 25% is almost certainly a typo
export const CASH_MAX_PERCENT = 25;

export const quoteTotalInc = (q) => gstBreakdown(itemsTotal(q?.items)).total;

// total inc GST -> the cash price inc GST (0 when there's nothing sensible to offer)
export function cashPriceOf(totalInc, percent = CASH_PERCENT, step = CASH_STEP) {
  const t = Math.round(Number(totalInc) * 100) / 100; // (to the cent first, so 8,699.999 behaves as 8,700)
  if (!(t > 0)) return 0;
  const p = Math.floor((Math.round(t * (1 - percent / 100) * 100) / 100) / step + 1e-9) * step;
  return p > 0 && p < t ? p : 0;
}

export const hasCashLine = (items) => (items || []).some((i) => String(i.desc || "").trim().toLowerCase() === CASH_LINE.toLowerCase());

// Is this a believable cash price for that total? (used on the server so a slip of the finger can't email "$78")
export function sensibleCashPrice(totalInc, price) {
  const t = Number(totalInc), p = Number(price);
  if (!(t > 0) || !(p > 0) || p >= t) return false;
  const off = (1 - p / t) * 100;
  return off >= CASH_MIN_PERCENT && off <= CASH_MAX_PERCENT;
}

// The paragraph added to the email. items: [{ label, total, price }] (one per quote in the email)
export function cashParagraph(items) {
  const list = (items || []).filter((i) => i && i.price > 0);
  if (!list.length) return "";
  const wholeDollars = (n) => money(n).replace(/\.00$/, "");
  if (list.length === 1) return `If you'd prefer to pay cash, the total comes to ${wholeDollars(list[0].price)} inc. GST (instead of ${wholeDollars(list[0].total)}).`;
  return [
    "If you'd prefer to pay cash, the totals come to:",
    ...list.map((i) => `${i.label}: ${wholeDollars(i.price)} inc. GST (instead of ${wholeDollars(i.total)})`),
  ].join("\n");
}

// Swap the old cash paragraph in the message for the new one (or remove it when `next` is empty), keeping anything else the user typed.
export function withCashParagraph(text, prev, next) {
  let t = String(text || "");
  if (prev && t.includes(prev)) t = t.replace(prev, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!next) return t;
  // goes after the opening paragraph(s), before nothing else: simplest and safest is the end of the message
  return `${t.replace(/\s+$/, "")}\n\n${next}`;
}

// The quote's items with the discount line set so the total inc GST is exactly `price`. Any earlier cash line is replaced.
export function applyCashPrice(items, price, makeId = () => Math.random().toString(36).slice(2, 10)) {
  const base = (items || []).filter((i) => String(i.desc || "").trim().toLowerCase() !== CASH_LINE.toLowerCase());
  const exNow = itemsTotal(base);
  const exTarget = Math.round((Number(price) / 1.1) * 100) / 100;
  const discount = Math.round((exNow - exTarget) * 100) / 100;
  if (!(discount > 0)) return base;
  return [...base, { id: makeId(), desc: CASH_LINE, qty: 1, rate: -discount, unit: "" }];
}

// the cash prices that were offered: { [quoteId]: price }
export function cashOffers(expenses) {
  const out = {};
  for (const e of expenses || []) {
    if (e && typeof e.id === "string" && e.id.startsWith(CASH_PREFIX)) {
      const n = Number(String(e.description || "").replace(/[^0-9.]/g, ""));
      if (n > 0) out[e.id.slice(CASH_PREFIX.length)] = n;
    }
  }
  return out;
}
