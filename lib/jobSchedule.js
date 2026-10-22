// How long a job takes, which working days it covers, and where unscheduled jobs
// could go. Pure functions, shared by the quote form, the Board and the iPhone
// calendar feed (via lib/schedule.js).
//
// Artie's rules of thumb, all in hours (a working day = 8 hours):
//   fencing        demo + install ~20m a day, so every 10m is half a day (4 hrs), rounded up
//                  to the next half day, with 0.5m of grace so 20.1m still counts as one day
//   gates          ~2 hrs each
//   post repairs   ~30 mins a post (6 posts = 3 hrs)
//   retaining wall ~5 m² a day (length x height), a rough guess since they're rare
// A duration typed on the quote always wins over the estimate.

export const HOURS_PER_DAY = 8;
export const METRES_PER_HALF_DAY = 10;
const GRACE_M = 0.5;
const GATE_HOURS = 2;
const POST_HOURS = 0.5;
const WALL_M2_PER_DAY = 5;
const UNKNOWN_HOURS = 4; // half a day when there's nothing to go on

export const isIsoDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function addDaysIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday

// Mon–Fri, plus Saturday for jobs flagged to run over it.
export const worksSaturday = (q) => String(q?.workSaturday || "").toLowerCase() === "yes";
export const isWorkDay = (iso, saturday) => {
  const d = weekday(iso);
  return (d >= 1 && d <= 5) || (saturday && d === 6);
};
export function nextWorkDay(iso, saturday) {
  let d = iso;
  for (let i = 0; i < 8 && !isWorkDay(d, saturday); i++) d = addDaysIso(d, 1);
  return d;
}

// Move a date forward (or back, with a negative n) by whole working days.
export function shiftWorkDays(iso, n, saturday) {
  const step = n < 0 ? -1 : 1;
  let d = iso;
  for (let left = Math.abs(n), guard = 0; left > 0 && guard < 400; guard++) {
    d = addDaysIso(d, step);
    if (isWorkDay(d, saturday)) left--;
  }
  return d;
}

const ceilTo = (n, step) => Math.ceil(n / step - 1e-9) * step;

// "2 hrs", "4 hrs", "1 day", "1½ days", "1¼ days"
export function hoursLabel(hours) {
  if (hours < HOURS_PER_DAY) return `${hours} hr${hours === 1 ? "" : "s"}`;
  const days = hours / HOURS_PER_DAY;
  const whole = Math.floor(days + 1e-9);
  const frac = Math.round((days - whole) * 4) / 4;
  const fracText = { 0: "", 0.25: "¼", 0.5: "½", 0.75: "¾", 1: "" }[frac];
  const shown = frac === 1 ? whole + 1 : whole;
  return `${shown}${fracText} ${shown === 1 && !fracText ? "day" : "days"}`;
}

// Run length in metres: the quote's job length, else the longest per-metre install line (ignoring removal lines).
export function jobLengthM(q) {
  const own = Number(q?.jobLength);
  if (own > 0) return own;
  const lens = (q?.items || [])
    .filter((it) => it.unit === "m" && !/removal/i.test(it.desc || ""))
    .map((it) => Number(it.qty) || 0);
  return lens.length ? Math.max(...lens) : 0;
}

// Gate lines look like "Supply and installation of a Colorbond pedestrian gate ..." — gate POSTS and castors don't count.
export function gateCount(q) {
  return (q?.items || [])
    .filter((it) => it.unit !== "m" && /\b(pedestrian|driveway|sliding|swing|double|single)\b[^.]*\bgates?\b/i.test(it.desc || ""))
    .reduce((s, it) => s + (Number(it.qty) || 1), 0);
}

// Lines priced per "post" (post replacement / repairs).
export function postCount(q) {
  return (q?.items || []).filter((it) => it.unit === "post").reduce((s, it) => s + (Number(it.qty) || 0), 0);
}

// -> { hours, source: "set" | "estimate" | "default", lengthM, gates, posts }
export function estimateHours(q) {
  const lengthM = jobLengthM(q);
  const gates = gateCount(q);
  const posts = postCount(q);
  const typed = Number(q?.durationHours);
  const base = { lengthM, gates, posts };
  if (typed > 0) return { ...base, hours: ceilTo(typed, 0.5), source: "set" };

  let hours = 0;
  switch (q?.jobType) {
    case "Repairs":
      hours = posts * POST_HOURS + gates * GATE_HOURS;
      break;
    case "Gates":
      hours = (gates > 0 ? gates * GATE_HOURS : GATE_HOURS) + posts * POST_HOURS;
      break;
    case "Retaining wall": {
      const area = lengthM * (Number(q?.fenceHeight) || 0);
      hours = area > 0 ? ceilTo((area / WALL_M2_PER_DAY) * HOURS_PER_DAY, 4) : HOURS_PER_DAY;
      break;
    }
    default:
      if (lengthM > 0) hours = Math.max(1, Math.ceil((lengthM - GRACE_M) / METRES_PER_HALF_DAY)) * (HOURS_PER_DAY / 2);
      hours += gates * GATE_HOURS + posts * POST_HOURS;
  }
  if (hours <= 0) return { ...base, hours: UNKNOWN_HOURS, source: "default" };
  return { ...base, hours: ceilTo(hours, 0.5), source: "estimate" };
}

// The working days a job covers, from its start date: [{ date, portion (of a day), hours }].
// The start date itself always counts (you picked it); later days skip non-working days.
export function jobDays(q) {
  if (!isIsoDate(q?.startDate)) return [];
  const saturday = worksSaturday(q);
  const out = [];
  let remaining = estimateHours(q).hours;
  let d = q.startDate;
  for (let guard = 0; remaining > 1e-9 && guard < 120; guard++, d = addDaysIso(d, 1)) {
    if (out.length > 0 && !isWorkDay(d, saturday)) continue;
    const hours = Math.min(HOURS_PER_DAY, remaining);
    out.push({ date: d, hours, portion: hours / HOURS_PER_DAY });
    remaining -= hours;
  }
  return out;
}

export const jobEndDate = (q) => {
  const days = jobDays(q);
  return days.length ? days[days.length - 1].date : null;
};

// Share of each date already taken by accepted, dated jobs: { "2026-10-19": 1, ... } (1 = a full day).
export function dayLoads(quotes) {
  const load = {};
  for (const q of quotes) {
    if (q.status !== "Accepted") continue;
    for (const d of jobDays(q)) load[d.date] = (load[d.date] || 0) + d.portion;
  }
  return load;
}

const acceptedKey = (q) => q.acceptedAt || q.date || "";

// Proposes start dates for accepted jobs that don't have one. Works from tomorrow, in the order jobs were
// accepted, around work that's already booked. A job runs on consecutive working days and is never split
// across a booked day; small jobs can share a day, and a day finishing early is fine.
export function suggestSchedule(quotes, today, { blocked = null } = {}) {
  const load = dayLoads(quotes.filter((q) => isIsoDate(q.startDate)));
  const todo = quotes
    .filter((q) => q.status === "Accepted" && !isIsoDate(q.startDate))
    .sort((a, b) => acceptedKey(a).localeCompare(acceptedKey(b)));
  const proposals = [];

  for (const q of todo) {
    const saturday = worksSaturday(q);
    const { hours } = estimateHours(q);
    let start = nextWorkDay(addDaysIso(today, 1), saturday);

    for (let attempt = 0; attempt < 400; attempt++, start = nextWorkDay(addDaysIso(start, 1), saturday)) {
      const placed = [];
      let remaining = hours;
      let d = start;
      let ok = true;
      for (let guard = 0; remaining > 1e-9 && guard < 120; guard++, d = addDaysIso(d, 1)) {
        if (placed.length > 0 && !isWorkDay(d, saturday)) continue;
        const portion = Math.min(HOURS_PER_DAY, remaining) / HOURS_PER_DAY;
        // A job of a day or more starts on a clear day; a shorter one just needs its own share to be free.
        const needed = hours >= HOURS_PER_DAY && placed.length === 0 ? 1 : portion;
        if (blocked && blocked.has(d)) { ok = false; break; } // a washed-out day in the forecast
        if (1 - (load[d] || 0) < needed - 1e-9) { ok = false; break; }
        placed.push({ date: d, portion });
        remaining -= portion * HOURS_PER_DAY;
      }
      if (ok && placed.length) {
        for (const p of placed) load[p.date] = (load[p.date] || 0) + p.portion;
        proposals.push({ quote: q, start, end: placed[placed.length - 1].date, hours });
        break;
      }
    }
  }
  return proposals;
}
