// Plans a day of quote visits: which order, what time at each, and what to move.
// Pure functions (no network) so they can be tested with a made-up driving-time table.
// Times are minutes since midnight throughout.
//
// How it decides (Artie's rules):
//   - every visit takes ~15 minutes (editable per visit)
//   - the day runs north to south: coming down from Brisbane/Cleveland, finishing near Burleigh,
//     so heading back north is penalised (not forbidden — sometimes it's the better run)
//   - times already given to clients are preferences, not promises: the plan may move them, and says so
//   - the last visit has to START by 5:45pm so it finishes by 6pm (sunset)
//   - if a weekday can't fit, the least efficient visits are suggested for Saturday

export const VISIT_MIN = 15;
export const LATEST_START = 17 * 60 + 45;
export const TRAFFIC_FACTOR = 1.2; // free-flow driving times are optimistic; allow a little for traffic

export const PLACES = {
  cleveland: { key: "cleveland", name: "Cleveland", lat: -27.5287, lon: 153.264 },
  brisbane: { key: "brisbane", name: "Brisbane", lat: -27.4698, lon: 153.0251 },
  burleigh: { key: "burleigh", name: "Burleigh (where you're staying)", lat: -28.0897, lon: 153.4486 },
};

// How much each thing "costs" in minutes of driving-equivalent when comparing orders.
const W = {
  shift: 0.15, // per minute a visit moves away from the time the client was given (your times are not locked in)
  idle: 0.5, // per minute spent waiting around
  north: 3, // per km driven back north between visits (you run north to south)
  end: 0.3, // per minute of the drive back to Burleigh at the end
  over: 50, // per minute a visit starts after the latest start (so we can always tell it doesn't fit)
};

const DAY_WAIT = 4; // cost per day a visit with no day yet is left waiting

// ---------- small helpers ----------
export const parseTime = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const fmtClock = (min) => {
  const m = Math.round(min);
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};
export const fmtHHMM = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min) % 60).padStart(2, "0")}`;

export function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Rough driving minutes when the routing service is unavailable: road distance ~1.35x the straight line at ~50 km/h.
export const estimateDriveMin = (a, b) => (haversineKm(a, b) * 1.35 * 60) / 50;

// ---------- planning one day ----------
// stops:   [{ id, node, lat, durationMin, preferred (minutes|null), locked (bool) }]
// minutes: driving-time table between nodes (already includes the traffic allowance)
// day:     { startNode, endNode, depart (minutes|null), earliestStart (minutes), latestStart, flexDepart (bool) }
//          flexDepart: `depart` is the EARLIEST you can leave, and the plan leaves as late as it can (so nobody is
//          rushed and there's no waiting around) — only ever moving early visits later, never the fixed ones.
// A stop can also carry notBefore / notAfter (minutes): the earliest and latest it can start (e.g. "from 3:30pm onwards").
// shiftWeight: how reluctant to be about moving times (lower = freer). lockTolerance: minutes late a locked time may run.
export function planDay({ stops, minutes, day, lockTimed = false, shiftWeight = W.shift, northWeight = W.north, lockTolerance = 5 }) {
  const { startNode, endNode, latestStart = LATEST_START } = day;
  const earliestStart = day.earliestStart ?? 0;
  const startLat = day.startLat;
  const list = stops.map((s) => ({ ...s, locked: s.locked || (lockTimed && s.preferred != null) }));
  const n = list.length;
  if (n === 0) return { order: [], entries: [], driveMin: 0, endLegMin: 0, finish: null, leave: null, fits: true, overBy: 0, cost: 0 };

  // Advance one stop from a state; null if it would miss a locked time.
  const step = (st, s, first) => {
    const drive = minutes[st.node][s.node];
    const clock = st.t ?? (day.depart != null ? day.depart : earliestStart - drive);
    const arrive = clock + drive;
    let start = Math.max(arrive, earliestStart);
    let cost = st.cost + drive;
    if (s.locked && s.preferred != null) {
      if (arrive > s.preferred + lockTolerance) return null;
      start = Math.max(arrive, s.preferred);
      if (arrive > s.preferred) cost += 20 * (arrive - s.preferred); // running late is worse than any detour
    } else if (s.preferred != null) {
      // Arriving a few minutes early for a time you gave the client: just wait for it rather than shift it.
      if (arrive < s.preferred && s.preferred - arrive <= 15) start = Math.max(start, s.preferred);
      cost += shiftWeight * Math.abs(start - s.preferred);
    }
    // Availability: not before X means wait for it; not after X means running past it is heavily penalised.
    if (s.notBefore != null && start < s.notBefore) start = s.notBefore;
    if (s.notAfter != null && start > s.notAfter) cost += 20 * (start - s.notAfter);
    const wait = start - arrive;
    // With a flexible departure, the first wait is free: leaving that much later removes it.
    if (day.flexDepart && wait > 0 && !st.waited) cost += 0;
    else cost += W.idle * wait;
    if (start > latestStart) cost += W.over * (start - latestStart);
    if (!first && s.lat > st.lat) cost += northWeight * (s.lat - st.lat) * 111;
    return { node: s.node, lat: s.lat, t: start + s.durationMin, cost, start, arrive, drive, wait, waited: st.waited || wait > 0, leaveAt: first ? clock : null };
  };

  const run = (order) => {
    let st = { node: startNode, lat: startLat ?? list[order[0]].lat, t: null, cost: 0, waited: false };
    const entries = [];
    for (let k = 0; k < order.length; k++) {
      const s = list[order[k]];
      const nx = step(st, s, k === 0);
      if (!nx) return null;
      entries.push({ id: s.id, arrive: nx.arrive, start: nx.start, end: nx.start + s.durationMin, driveMin: nx.drive, wait: nx.wait, preferred: s.preferred ?? null, notBefore: s.notBefore ?? null, notAfter: s.notAfter ?? null, locked: !!s.locked, durationMin: s.durationMin, lateBy: s.locked && s.preferred != null ? Math.max(0, Math.round(nx.arrive - s.preferred)) : 0 });
      if (k === 0) entries.leave = nx.leaveAt;
      st = nx;
    }
    // Flexible departure: leave later by the first wait, so the visits before it all slide later and nobody waits.
    if (day.flexDepart) {
      const k = entries.findIndex((e) => e.wait > 0.5);
      if (k >= 0) {
        const delay = entries[k].wait;
        for (let i = 0; i < k; i++) { entries[i].arrive += delay; entries[i].start += delay; entries[i].end += delay; }
        entries[k].arrive += delay;
        entries[k].wait = 0;
        entries.leave += delay;
      }
    }
    const endLeg = minutes[st.node][endNode];
    return { cost: st.cost + W.end * endLeg, entries, endLeg, lastNode: st.node };
  };

  // Search: depth-first over orders with pruning, trying northern stops first so a good answer is found early.
  const byNorth = list.map((_, i) => i).sort((a, b) => list[b].lat - list[a].lat);
  let best = null;
  // An order you set by dragging a visit: used as it is, so long as it covers exactly these visits and doesn't break a locked time.
  let forced = false;
  let forcedBroken = false;
  const wanted = day.forceOrder;
  if (Array.isArray(wanted) && wanted.length === n && new Set(wanted).size === n && wanted.every((id) => list.some((s) => s.id === id))) {
    const order = wanted.map((id) => list.findIndex((s) => s.id === id));
    const r = run(order);
    if (r) { best = { cost: r.cost, order }; forced = true; } else forcedBroken = true;
  }
  if (best) {
    // order already chosen
  } else if (n <= 9) {
    const used = Array(n).fill(false);
    const order = [];
    const dfs = (st, depth) => {
      if (best && st.cost >= best.cost) return;
      if (depth === n) {
        const total = st.cost + W.end * minutes[st.node][endNode];
        if (!best || total < best.cost) best = { cost: total, order: order.slice() };
        return;
      }
      for (const i of byNorth) {
        if (used[i]) continue;
        const nx = step(st, list[i], depth === 0);
        if (!nx) continue;
        used[i] = true;
        order.push(i);
        dfs(nx, depth + 1);
        order.pop();
        used[i] = false;
      }
    };
    dfs({ node: startNode, lat: startLat ?? list[byNorth[0]].lat, t: null, cost: 0, waited: false }, 0);
  } else {
    // Many stops: start north to south, then keep making swaps/moves that help.
    let order = byNorth.slice();
    let cur = run(order);
    if (!cur) {
      order = list.map((_, i) => i);
      cur = run(order);
    }
    let improved = !!cur;
    for (let pass = 0; improved && pass < 30; pass++) {
      improved = false;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const cand = order.slice();
          const [x] = cand.splice(i, 1);
          cand.splice(j, 0, x);
          const r = run(cand);
          if (r && r.cost < cur.cost - 1e-6) { order = cand; cur = r; improved = true; }
        }
      }
    }
    if (cur) best = { cost: cur.cost, order };
  }

  if (!best) return { infeasible: true, order: [], entries: [], fits: false };
  const r = run(best.order);
  const entries = r.entries;
  const last = entries[entries.length - 1];
  return {
    order: best.order.map((i) => list[i].id),
    entries: Array.from(entries),
    leave: entries.leave,
    driveMin: entries.reduce((s, e) => s + e.driveMin, 0),
    endLegMin: r.endLeg,
    finish: last.end,
    fits: last.start <= latestStart + 1e-6,
    overBy: Math.max(0, last.start - latestStart),
    cost: r.cost,
    forced, // this order is the one you dragged it into
    forcedBroken, // you dragged an order, but it would miss a locked time, so the best route is shown instead
  };
}

// ---------- a whole stretch of days ----------
// days:    [{ date, saturday (bool), day: {startNode,endNode,depart,earliestStart,startLat}, stops: [...] }]
// flexible: stops with no day yet: [{ ...stop, deadline: ISO|null }]
// Returns plans by date plus what was moved and anything that still doesn't fit.
export function planDays({ days, flexible = [], minutes, today = null, shiftWeight = W.shift, northWeight = W.north }) {
  const byDate = new Map(days.map((d) => [d.date, { ...d, stops: d.stops.slice(), moved: [] }]));
  const plan = (d) => planDay({ stops: d.stops, minutes, day: d.day, shiftWeight, northWeight });
  const notes = [];

  // 1) Flexible stops (e.g. a site visit with no day): put each where it adds the least driving, before its deadline.
  for (const f of flexible) {
    let bestDay = null;
    for (const d of byDate.values()) {
      if (f.deadline && d.date > f.deadline) continue;
      const before = plan(d);
      const trial = { ...d, stops: [...d.stops, f] };
      const after = plan(trial);
      if (after.infeasible || !after.fits) continue;
      // A little extra cost per day of waiting, so a client isn't left for weeks just to save a few minutes of driving.
      const wait = today ? Math.max(0, Math.round((Date.parse(`${d.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)) : 0;
      const added = after.cost - (before.cost ?? 0) + DAY_WAIT * wait;
      if (!bestDay || added < bestDay.added - 1e-6) bestDay = { d, added };
    }
    if (bestDay) {
      bestDay.d.stops.push({ ...f, placed: true });
    } else {
      notes.push({ kind: "unplaced", id: f.id, text: `${f.name} doesn't fit on any day${f.deadline ? " before its deadline" : ""}.` });
    }
  }

  // 2) A weekday that can't fit: move the least efficient visits to the next Saturday, one at a time.
  const nextSaturday = (date) => [...byDate.values()].filter((d) => d.saturday && d.date > date).sort((a, b) => a.date.localeCompare(b.date))[0];
  for (const d of [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    if (d.saturday) continue;
    let p = plan(d);
    while (!p.fits && d.stops.length > 1) {
      const sat = nextSaturday(d.date);
      if (!sat) break;
      let bestMove = null;
      for (const s of d.stops) {
        if (s.locked || s.fixedDay) continue;
        const without = plan({ ...d, stops: d.stops.filter((x) => x.id !== s.id) });
        if (without.infeasible) continue;
        const gain = p.cost - without.cost;
        if (!bestMove || gain > bestMove.gain) bestMove = { s, gain };
      }
      if (!bestMove) break;
      d.stops = d.stops.filter((x) => x.id !== bestMove.s.id);
      d.moved.push(bestMove.s);
      sat.stops.push({ ...bestMove.s, movedFrom: d.date });
      p = plan(d);
    }
  }

  const suggestions = today ? suggestMoves({ byDate, plan, today }) : [];

  const out = {};
  for (const d of byDate.values()) {
    const p = plan(d);
    // What would it look like keeping every time as booked?
    const asBooked = d.stops.some((s) => s.preferred != null) ? planDay({ stops: d.stops, minutes, day: d.day, lockTimed: true, lockTolerance: 30, northWeight }) : null;
    // What each visit costs this day: how much driving, and how much earlier you'd finish, if it went elsewhere (e.g. Saturday).
    const moveSavings = {};
    if (!d.saturday && d.stops.length > 1 && !p.infeasible) {
      for (const s of d.stops) {
        const without = plan({ ...d, stops: d.stops.filter((x) => x.id !== s.id) });
        if (!without.infeasible) moveSavings[s.id] = { driveMin: p.driveMin - without.driveMin, finishMin: p.finish - without.finish };
      }
    }
    out[d.date] = { date: d.date, saturday: d.saturday, stops: d.stops, moved: d.moved, plan: p, asBooked, moveSavings };
  }
  // "What if this visit went on that day?" — for the Move screen: does it fit, how much driving it adds, how full the day would be.
  const fitFor = (stopId, date) => {
    const src = [...byDate.values()].flatMap((d) => d.stops).find((x) => x.id === stopId);
    const t = byDate.get(date);
    if (!src || !t) return null;
    const others = t.stops.filter((x) => x.id !== stopId);
    const before = plan({ ...t, stops: others });
    const there = { ...t, stops: [...others, { ...src, preferred: null }] };
    const after = plan(there);
    if (after.infeasible) return { ok: false };
    return {
      ok: true,
      fits: after.fits,
      existing: others.length,
      visits: there.stops.length,
      addedDriveMin: Math.round(after.driveMin - (before.driveMin || 0)),
      finish: after.finish,
      strain: dayStrain(after, there.stops, there.day),
    };
  };

  return { days: out, notes, suggestions, fitFor };
}

// ---------- common-sense suggestions ----------
// How strained a day is: 0 = comfortable. Counts a last visit that can't start by 5:45, clients' booked times being
// pushed around by more than 20 minutes, someone's "not after" being missed, long waits, and simply too many visits.
export function dayStrain(p, stops, day = null) {
  if (!p || p.infeasible) return 1000;
  let score = 0;
  // A day that can "leave later if it helps" but ends up leaving hours later than it could (everything slides into the
  // afternoon to suit one late visit) isn't a good day for that visit.
  if (day?.flexDepart && day.depart != null && p.leave != null && p.leave - day.depart > 60) score += (p.leave - day.depart - 60) * 0.25;
  if (!p.fits) score += 100 + p.overBy;
  for (const e of p.entries) {
    if (e.preferred != null) score += Math.max(0, Math.abs(e.start - e.preferred) - 20);
    if (e.notAfter != null && e.start > e.notAfter) score += 3 * (e.start - e.notAfter);
    if (e.wait > 45) score += (e.wait - 45) * 0.5;
  }
  if (stops.length > 6) score += (stops.length - 6) * 20;
  return score;
}

const STRAIN_LIMIT = 40; // above this a day needs help
const BUSY_DAY = 6; // more visits than this in a day is a lot, whatever the clock says

// For each strained day, suggests which visit to move and where, one at a time, on a working copy.
//   - Visits with no booked time go first (the client hasn't been promised anything); a visit that has a time is only
//     suggested when nothing else would help.
//   - A visit that can't start until mid-afternoon is a natural one to shift out of a full day.
//   - The new day has to fit the visit's availability and not be strained by it; sooner beats later, less driving beats more.
//   - On the new day the old booked time no longer applies (the client has to be asked again).
// Returns [{ stopId, name, from, to, eases, addsDriveMin, notBefore, bookedTime }].
export function suggestMoves({ byDate, plan, today, maxPerDay = 3 }) {
  const work = new Map([...byDate.entries()].map(([k, d]) => [k, { ...d, stops: d.stops.slice() }]));
  const strainOf = (d) => dayStrain(plan(d), d.stops, d.day);
  const daysOut = (date) => Math.max(0, Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000));
  const out = [];

  // Where could this visit go instead, and what would that cost? -> { t, extra, added, score } for the best day, or null
  const bestHome = (s, from, eases, lateWindow) => {
    let best = null;
    const moved = { ...s, preferred: null };
    for (const t of work.values()) {
      if (t.date === from.date || t.date <= today) continue;
      if (s.deadline && t.date > s.deadline) continue;
      const there = { ...t, stops: [...t.stops, moved] };
      const tp = plan(there);
      if (tp.infeasible || !tp.fits) continue;
      const extra = strainOf(there) - strainOf(t);
      if (extra > 15) continue;
      const added = tp.driveMin - plan(t).driveMin;
      const score = extra * 2 + added * 0.3 + daysOut(t.date) * 3 - eases - (lateWindow ? 25 : 0);
      if (!best || score < best.score) best = { t, extra, added, score };
    }
    return best;
  };

  for (const d of [...work.values()].filter((x) => x.date >= today).sort((a, b) => a.date.localeCompare(b.date))) {
    let askedBooked = false; // at most one client with a booked time is suggested per day, so it never cascades
    for (let round = 0; round < maxPerDay; round++) {
      const base = strainOf(d);
      if (base <= STRAIN_LIMIT || d.stops.length < 2) break;

      const movable = d.stops.filter((s) => !s.locked && !s.fixedDay && !s.placed);
      let best = null;
      for (const tier of [movable.filter((s) => s.preferred == null), movable]) {
        for (const s of tier) {
          const without = { ...d, stops: d.stops.filter((x) => x.id !== s.id) };
          const eases = base - strainOf(without);
          const lateWindow = s.notBefore != null && s.notBefore >= 15 * 60;
          if (eases < 10 && !lateWindow && d.stops.length <= BUSY_DAY) continue; // taking it out wouldn't help
          const home = bestHome(s, d, eases, lateWindow);
          if (!home) continue;
          if (!best || home.score < best.score) best = { s, ...home, eases };
        }
        if (best) break; // only fall through to visits with booked times if nothing else would do
      }
      if (!best) break;
      if (best.s.preferred != null) {
        if (askedBooked) break;
        askedBooked = true;
      }

      d.stops = d.stops.filter((x) => x.id !== best.s.id);
      best.t.stops = [...best.t.stops, { ...best.s, preferred: null }];
      out.push({ stopId: best.s.id, name: best.s.name, from: d.date, to: best.t.date, eases: Math.round(best.eases), addsDriveMin: Math.round(best.added), notBefore: best.s.notBefore ?? null, bookedTime: best.s.preferred ?? null });
    }
  }
  return out;
}
