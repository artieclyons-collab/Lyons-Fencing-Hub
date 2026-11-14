// What you're winning and losing on quotes, and whether getting a quote out quickly makes a difference.
// A quote is "won" when it's Accepted, "lost" when it's Declined, "went quiet" when it was Sent more than QUIET_DAYS ago and nobody answered
// (most clients just stop replying rather than say no, so that counts as lost), and "open" while it's still inside that window.
// Drafts aren't counted. Speed is the days from the lead coming in to the first quote going out (both are dates, so it's whole days).
import { itemsTotal, gstBreakdown } from "./logic";
import { quotesForLead } from "./quoteDecision";

export const QUIET_DAYS = 21;

const incTotal = (items) => gstBreakdown(itemsTotal(items)).total;
const toMs = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
const validDay = (iso) => /^\d{4}-\d{2}-\d{2}/.test(String(iso || ""));
export const daysBetween = (a, b) => Math.round((toMs(b) - toMs(a)) / 86400000);

export function outcomeOf(q, todayIso) {
  if (q.status === "Accepted") return "won";
  if (q.status === "Declined") return "lost";
  if (q.status !== "Sent") return null; // a draft
  if (!validDay(q.date)) return "open";
  return daysBetween(q.date, todayIso) > QUIET_DAYS ? "quiet" : "open";
}

const PRICE_BANDS = [
  { label: "Under $1,500", max: 1500 },
  { label: "$1,500 to $3,500", max: 3500 },
  { label: "$3,500 to $7,000", max: 7000 },
  { label: "Over $7,000", max: Infinity },
];
const SPEED_BANDS = [
  { label: "Same day", test: (d) => d <= 0 },
  { label: "Next day", test: (d) => d === 1 },
  { label: "2 to 3 days", test: (d) => d >= 2 && d <= 3 },
  { label: "4 days or more", test: (d) => d >= 4 },
];

const tally = (label) => ({ label, sent: 0, won: 0, lost: 0, open: 0 });
const add = (t, outcome) => {
  t.sent += 1;
  if (outcome === "won") t.won += 1; else if (outcome === "open") t.open += 1; else t.lost += 1;
};
// win rate among the quotes that have a result (open ones aren't counted either way yet)
export const rate = (t) => (t.won + t.lost > 0 ? t.won / (t.won + t.lost) : null);

export function quoteResults(leads, quotes, todayIso) {
  const all = (quotes || []).map((q) => ({ q, outcome: outcomeOf(q, todayIso) })).filter((x) => x.outcome);
  const overall = tally("All quotes");
  const byType = new Map();
  const byPrice = PRICE_BANDS.map((b) => tally(b.label));
  let wonValue = 0;
  let lostValue = 0;
  for (const { q, outcome } of all) {
    add(overall, outcome);
    const type = q.jobType || "Other";
    if (!byType.has(type)) byType.set(type, tally(type));
    add(byType.get(type), outcome);
    const total = incTotal(q.items);
    add(byPrice[PRICE_BANDS.findIndex((b) => total < b.max)], outcome);
    if (outcome === "won") wonValue += total; else if (outcome !== "open") lostValue += total;
  }

  // speed: one row per lead, from the lead's date to the first quote sent to that client on or after it
  const bySpeed = SPEED_BANDS.map((b) => tally(b.label));
  const gaps = [];
  for (const lead of leads || []) {
    if (!validDay(lead.createdAt)) continue;
    const mine = quotesForLead(quotes || [], lead)
      .filter((q) => q.status !== "Draft" && validDay(q.date) && daysBetween(String(lead.createdAt).slice(0, 10), q.date) >= 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!mine.length) continue;
    const gap = daysBetween(String(lead.createdAt).slice(0, 10), mine[0].date);
    gaps.push(gap);
    const outs = mine.map((q) => outcomeOf(q, todayIso));
    const outcome = outs.includes("won") ? "won" : outs.includes("open") ? "open" : "lost";
    add(bySpeed[SPEED_BANDS.findIndex((b) => b.test(gap))], outcome);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const average = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null;

  return {
    overall,
    wonValue,
    lostValue,
    byType: [...byType.values()].sort((a, b) => b.sent - a.sent),
    byPrice: byPrice.filter((t) => t.sent),
    bySpeed: bySpeed.filter((t) => t.sent),
    quotedLeads: gaps.length,
    median,
    average,
  };
}

// A plain-English line about what the speed numbers say, or "" when there isn't enough to say anything yet
export function speedInsight(bySpeed) {
  const usable = bySpeed.filter((t) => t.won + t.lost >= 3);
  if (usable.length < 2) return "";
  const best = [...usable].sort((a, b) => rate(b) - rate(a))[0];
  const worst = [...usable].sort((a, b) => rate(a) - rate(b))[0];
  if (best === worst || rate(best) - rate(worst) < 0.1) return "Speed doesn't seem to change how many you win so far.";
  return `You win most when the quote goes out ${best.label.toLowerCase()} (${Math.round(rate(best) * 100)}%) and least at ${worst.label.toLowerCase()} (${Math.round(rate(worst) * 100)}%).`;
}
