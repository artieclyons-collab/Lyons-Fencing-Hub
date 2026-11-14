// "5 days" in a follow-up reads like a robot; "a week ago" reads like you. -> "a few days ago" / "a week ago" / "a couple of weeks ago" /
// "a few weeks ago" / "about a month ago".
export function casualAgo(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d < 0) return "recently";
  if (d <= 4) return "a few days ago";
  if (d <= 9) return "a week ago";
  if (d <= 17) return "a couple of weeks ago";
  if (d <= 27) return "a few weeks ago";
  return "about a month ago";
}

// whole days from an ISO date ("2026-11-02") to today in Brisbane
export function daysSinceIso(iso, now = new Date()) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
  return Math.round((Date.UTC(+parts.year, +parts.month - 1, +parts.day) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000);
}
