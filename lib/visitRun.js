// Glue for the visit planner screen: builds the list of places for the driving-time lookup, then runs the plan.
import { PLACES, planDays, TRAFFIC_FACTOR } from "./visitPlanner";
import { defaultDaySettings, isSaturday } from "./visitData";
import { addDaysIso } from "./jobSchedule";

const PLACE_ORDER = ["cleveland", "brisbane", "burleigh"]; // nodes 0, 1, 2

// Places for the driving-time table: the three start/stay points, then every stop that could be located.
export function buildNodes(stops, coords) {
  const unique = [...new Map(stops.filter((s) => coords[s.query]).map((s) => [s.id, s])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const nodes = [
    ...PLACE_ORDER.map((k) => ({ lat: PLACES[k].lat, lon: PLACES[k].lon })),
    ...unique.map((s) => ({ lat: coords[s.query].lat, lon: coords[s.query].lon })),
  ];
  const index = Object.fromEntries(unique.map((s, i) => [s.id, i + PLACE_ORDER.length]));
  return { nodes, index, missing: stops.filter((s) => !coords[s.query]) };
}

// overrides: { [date]: { start, depart, earliestStart, flexDepart } }   locks: { [stopId]: true }
// durations: { [stopId]: minutes }   moves: { [stopId]: date } — visits you've chosen to do on a different day
export function runPlan({ confirmed: confirmedIn, flexible, coords, minutesRaw, index, overrides = {}, locks = {}, durations = {}, moves = {}, shiftWeight, northWeight }) {
  const factor = (m) => m.map((row, i) => row.map((v, j) => (i === j ? 0 : Math.ceil(v * TRAFFIC_FACTOR))));
  const minutes = factor(minutesRaw);
  const confirmed = confirmedIn.map((s) => (moves[s.id] && moves[s.id] !== s.date ? { ...s, date: moves[s.id], movedFrom: s.date, movedByYou: true } : s));

  const prep = (s) => ({
    ...s,
    node: index[s.id],
    lat: coords[s.query].lat,
    lon: coords[s.query].lon,
    locked: !!locks[s.id],
    durationMin: durations[s.id] ?? s.durationMin,
  });
  const usable = (s) => index[s.id] !== undefined;

  const dates = new Set(confirmed.filter(usable).map((s) => s.date));
  // Every weekday run needs a Saturday to spill into.
  for (const d of [...dates]) {
    if (isSaturday(d)) continue;
    let sat = d;
    for (let i = 0; i < 7 && !isSaturday(sat); i++) sat = addDaysIso(sat, 1);
    dates.add(sat);
  }

  const days = [...dates].sort().map((date) => {
    const cfg = { ...defaultDaySettings(date), ...(overrides[date] || {}) };
    const place = PLACES[cfg.start] || PLACES.cleveland;
    return {
      date,
      saturday: isSaturday(date),
      settings: cfg,
      day: { startNode: PLACE_ORDER.indexOf(place.key), endNode: 2, depart: cfg.depart, earliestStart: cfg.earliestStart ?? 0, startLat: place.lat, flexDepart: !!cfg.flexDepart && cfg.depart != null },
      stops: confirmed.filter((s) => s.date === date && usable(s)).map(prep),
    };
  });

  const result = planDays({ days, flexible: flexible.filter(usable).map(prep), minutes, shiftWeight, northWeight });
  for (const d of days) result.days[d.date].settings = d.settings;
  result.minutes = minutes;
  return result;
}
