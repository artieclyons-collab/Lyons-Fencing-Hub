// The cash price offered when a client asks for one: about 10% off the total, rounded DOWN to the nearest $50, so it lands on a nice round
// number ($8,700 -> $7,800). Two small System rows in the expenses table keep it, so nothing needs a database change:
//   "cash-<quoteId>"     the price that was OFFERED in the email (the description is the dollar figure)
//   "cashdeal-<quoteId>" the client took it: they pay this much in cash. The quote and invoices the client was sent are NOT changed; the hub's
//                        own figures (income, owing, profit by job) use the cash price (lib/finances.js takes the shortfall off the final invoice).
// Pure functions (the email box, the quote editor and the finances all import this).
import { itemsTotal, gstBreakdown, money } from "./logic";

export const CASH_PREFIX = "cash-";
export const DEAL_PREFIX = "cashdeal-";
export const CASH_PERCENT = 10;
export const CASH_STEP = 50;
export const CASH_MIN_PERCENT = 3; // an offer smaller than this isn't really a discount, and bigger than 25% is almost certainly a typo
export const CASH_MAX_PERCENT = 25;

export const quoteTotalInc = (q) => gstBreakdown(itemsTotal(q?.items)).total;

// total -> the cash price (0 when there's nothing sensible to offer)
export function cashPriceOf(totalInc, percent = CASH_PERCENT, step = CASH_STEP) {
  const t = Math.round(Number(totalInc) * 100) / 100; // (to the cent first, so 8,699.999 behaves as 8,700)
  if (!(t > 0)) return 0;
  const p = Math.floor((Math.round(t * (1 - percent / 100) * 100) / 100) / step + 1e-9) * step;
  return p > 0 && p < t ? p : 0;
}

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
  if (list.length === 1) return `If you'd prefer to pay cash, the total comes to ${wholeDollars(list[0].price)} (instead of ${wholeDollars(list[0].total)}).`;
  return [
    "If you'd prefer to pay cash, the totals come to:",
    ...list.map((i) => `${i.label}: ${wholeDollars(i.price)} (instead of ${wholeDollars(i.total)})`),
  ].join("\n");
}

// Swap the old cash paragraph in the message for the new one (or remove it when `next` is empty), keeping anything else the user typed.
export function withCashParagraph(text, prev, next) {
  let t = String(text || "");
  if (prev && t.includes(prev)) t = t.replace(prev, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!next) return t;
  return `${t.replace(/\s+$/, "")}\n\n${next}`;
}

const priceMap = (expenses, prefix) => {
  const out = {};
  for (const e of expenses || []) {
    if (e && typeof e.id === "string" && e.id.startsWith(prefix)) {
      const n = Number(String(e.description || "").replace(/[^0-9.]/g, ""));
      if (n > 0) out[e.id.slice(prefix.length)] = n;
    }
  }
  return out;
};
// the cash prices that were offered: { [quoteId]: price }
export const cashOffers = (expenses) => priceMap(expenses, CASH_PREFIX);
// the cash deals that were agreed: { [quoteId]: price }
export const cashDeals = (expenses) => priceMap(expenses, DEAL_PREFIX);
