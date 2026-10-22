// Glue for the visit planner screen: builds the list of places for the driving-time lookup, then runs the plan.
import { PLACES, planDays, TRAFFIC_FACTOR } from "./visitPlanner";
import { defaultDaySettings, isSaturday, HOME, WORK_START } from "./visitData";
import { addDaysIso } from "./jobSchedule";

const PLACE_ORDER = ["cleveland", "brisbane", "burleigh"]; // nodes 0, 1, 2
const MIDDAY_DEFAULT = 12 * 60;
const HORIZON_DAYS = 10;
const ceil15 = (m) => Math.ceil(m / 15) * 15;

// Places for the driving-time table: the three start/stay points, then every stop that could be located
// (visits, plus home and the job sites, which are passed in the same way with an id and a query).
export function buildNodes(stops, coords) {
  const unique = [...new Map(stops.filter((s) => coords[s.query]).map((s) => [s.id, s])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const nodes = [
    ...PLACE_ORDER.map((k) => ({ lat: PLACES[k].lat, lon: PLACES[k].lon })),
    ...unique.map((s) => ({ lat: coords[s.query].lat, lon: coords[s.query].lon })),
  ];
  const index = Object.fromEntries(unique.map((s, i) => [s.id, i + PLACE_ORDER.length]));
  return { nodes, index, missing: stops.filter((s) => !coords[s.query]) };
}

// overrides: { [date]: { start, depart, earliestStart, flexDepart, workEnd } }   locks: { [stopId]: true }
// durations: { [stopId]: minutes }   moves: { [stopId]: date } — visits you've chosen to do on a different day
// midday: { [stopId]: true|false } — do this visit in the middle of a job day (true) or after work (false); unset = decided from the time given
// jobs: [{ id, date, name, address, query, hours }] — the days you're on a job; home is the node with id "home"
export function runPlan({ confirmed: confirmedIn, flexible, coords, minutesRaw, index, overrides = {}, locks = {}, durations = {}, moves = {}, midday = {}, jobs = [], workStart = WORK_START, today = null, shiftWeight, northWeight }) {
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

  const hasHome = index.home !== undefined;
  const homeNode = hasHome ? index.home : PLACE_ORDER.indexOf("burleigh");
  const jobByDate = new Map(jobs.filter((j) => index[j.id] !== undefined && coords[j.query]).map((j) => [j.date, j]));

  const confirmedDates = new Set(confirmed.filter(usable).map((s) => s.date));
  const dates = new Set(confirmedDates);
  // Every weekday run needs a Saturday to spill into.
  for (const d of [...dates]) {
    if (isSaturday(d)) continue;
    let sat = d;
    for (let i = 0; i < 7 && !isSaturday(sat); i++) sat = addDaysIso(sat, 1);
    dates.add(sat);
  }
  // Days on a job are candidates for visits that have no day yet (they're dropped again if nothing lands on them).
  for (const d of jobByDate.keys()) dates.add(d);
  // So is every day over the next week and a half (bar Sundays): somewhere for a visit to be placed or moved to.
  if (today) {
    for (let i = 1; i <= HORIZON_DAYS; i++) {
      const d = addDaysIso(today, i);
      if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) dates.add(d);
    }
  }

  const days = [...dates].sort().map((date) => {
    const ov = overrides[date] || {};
    const job = jobByDate.get(date) || null;
    const all = confirmed.filter((s) => s.date === date && usable(s)).map(prep);
    const common = { date, saturday: isSaturday(date), candidate: !confirmedDates.has(date), job: null, midday: [] };

    if (job && (ov.start === undefined || ov.start === "job")) {
      const jobNode = index[job.id];
      const jobPlace = { lat: coords[job.query].lat, lon: coords[job.query].lon };
      const baseEnd = ceil15(workStart + job.hours * 60);
      const workEnd = ov.workEnd ?? baseEnd;
      // A client who gave a time while you're still working gets a quick trip out of the job, then you carry on.
      const isMid = (s) => midday[s.id] === true || (midday[s.id] !== false && s.preferred != null && s.preferred < workEnd - 10);
      const mids = all.filter(isMid).sort((a, b) => (a.notBefore ?? a.preferred ?? MIDDAY_DEFAULT) - (b.notBefore ?? b.preferred ?? MIDDAY_DEFAULT));
      let away = 0;
      const midEntries = mids.map((s) => {
        const start = s.notBefore ?? s.preferred ?? MIDDAY_DEFAULT;
        const out = minutes[jobNode][s.node];
        const back = minutes[s.node][jobNode];
        away += out + s.durationMin + back;
        return {
          id: s.id, stop: s, midday: true, start, end: start + s.durationMin, durationMin: s.durationMin, preferred: s.preferred ?? null,
          driveMin: out, driveBack: back, leave: start - out, back: start + s.durationMin + back, awayMin: out + s.durationMin + back, lateBy: 0,
        };
      });
      const finishWork = workEnd + away;
      return {
        ...common,
        job: { id: job.id, name: job.name, address: job.address, query: job.query, hours: job.hours, workStart, baseEnd, workEnd, awayMin: away, finishWork },
        midday: midEntries,
        settings: { start: "job", workEnd, depart: finishWork, earliestStart: 0, flexDepart: true },
        day: { startNode: jobNode, endNode: homeNode, depart: finishWork, earliestStart: 0, startLat: jobPlace.lat, flexDepart: true },
        stops: all.filter((s) => !isMid(s)),
      };
    }

    const dflt = defaultDaySettings(date);
    const cfg = { ...dflt, ...ov };
    if (cfg.start === "job") cfg.start = dflt.start; // the job that day is gone
    const place = PLACES[cfg.start] || PLACES.cleveland;
    // "Burleigh" means home when home could be found on the map.
    const startNode = cfg.start === "burleigh" && hasHome ? homeNode : PLACE_ORDER.indexOf(place.key);
    return {
      ...common,
      job: job ? { id: job.id, name: job.name, address: job.address, query: job.query, hours: job.hours, workStart, baseEnd: ceil15(workStart + job.hours * 60), workEnd: ceil15(workStart + job.hours * 60), awayMin: 0 } : null,
      settings: cfg,
      day: { startNode, endNode: homeNode, depart: cfg.depart, earliestStart: cfg.earliestStart ?? 0, startLat: cfg.start === "burleigh" && hasHome ? coords[HOME.query].lat : place.lat, flexDepart: !!cfg.flexDepart && cfg.depart != null },
      stops: all,
    };
  });

  const result = planDays({ days, flexible: flexible.filter(usable).map(prep), minutes, today, shiftWeight, northWeight });
  for (const d of days) {
    const out = result.days[d.date];
    out.settings = d.settings;
    out.job = d.job;
    out.midday = d.midday;
    // A job day nothing was placed on isn't a visit day.
    if (d.candidate && out.stops.length === 0 && out.midday.length === 0) delete result.days[d.date];
  }
  result.minutes = minutes;
  result.hasHome = hasHome;
  // Only suggest moving visits that are still in the list after any automatic Saturday overflow, and name the dates in words for the screen.
  result.suggestions = (result.suggestions || []).filter((x) => result.days[x.from]);
  return result;
}
