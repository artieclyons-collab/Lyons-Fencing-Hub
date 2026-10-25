// Turns the quick notes taken on site ("26m 1.8 colorbond raked", "remove old fence", "1 gate") into draft quote lines,
// using the same job templates and rates as the quote form. Pure text in, lines out — nothing is saved or sent.
//
// Write one job per line (or separate with + or ;). Several quotes for the same client go in the same notes, each in its own paragraph
// (a blank line between them, optionally with a heading line like "Left side"): see parseSiteJobs.
// Write one job per line (or separate with + or ;). Anything it doesn't recognise is simply ignored, so ordinary notes
// ("dog in yard, call before arriving") can sit alongside. It lists what it assumed so you can check before saving.
import { JOB_TEMPLATES } from "./constants";

const NUMBER_WORDS = { a: 1, one: 1, single: 1, two: 2, double: 2, three: 3, four: 4, five: 5 };

const template = (label) => JOB_TEMPLATES.find((t) => t.label === label);
const line = (uid, t, qty) => ({ id: uid(), desc: t.desc, qty, rate: t.rate, unit: t.unit, tpl: t.label });

// Which fence template fits? -> { label, note } (note when we had to settle for the closest one)
export function pickFence({ style, height, raked, sleeper, lapped, slat90 }) {
  if (style === "aluminium") {
    const label = `Aluminium slat fence installation 1.8m (${slat90 ? 90 : 65}mm slats)`;
    return Number(height) > 1.85 ? { label, note: "Aluminium slat fencing only has a 1.8m template, so I used that — check the height, slat count and rate." } : { label };
  }
  let h = Number(height) || 1.8;
  let slp = !!sleeper;
  if (h >= 1.95 && h <= 2.05) slp = true; // a "2m" fence is 1.8m sheets/palings on a 200mm sleeper
  if (h < 1.95) h = 1.8;
  else if (h > 2.05) h = 2.1;
  const size = slp ? "w/ sleeper 2m" : h === 2.1 ? "2.1m" : "1.8m";
  if (style === "colorbond") {
    if (raked) {
      if (h === 2.1 && !slp) return { label: "Raked Colorbond fence installation 1.8m", note: "There's no 2.1m raked Colorbond template, so I used the 1.8m raked one — check the height and rate." };
      return { label: slp ? "Raked Colorbond fence installation w/ sleeper 2m" : "Raked Colorbond fence installation 1.8m" };
    }
    return { label: `Colorbond fence installation ${size}` };
  }
  return { label: lapped ? `Lapped & capped timber fence installation ${size}` : `Butted paling timber fence installation ${size}` };
}

const NUM = /(\d+(?:\.\d+)?)\s*(mm|m|mtrs?|metres?|meters?|lm)?(?!\d|\.\d)/gi;

// Pulls the lengths, heights and counts out of one chunk of text.
function readNumbers(s) {
  const lengths = [];
  const heights = [];
  let withUnit = false;
  let m;
  NUM.lastIndex = 0;
  while ((m = NUM.exec(s))) {
    let v = Number(m[1]);
    const unit = (m[2] || "").toLowerCase();
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 14);
    const before = s.slice(Math.max(0, m.index - 6), m.index);
    // "2 gates", "3 posts", "x2": a count, not a measurement. A time ("3:30", "4pm") isn't one either.
    if (/^\s*(?:x\s*)?(?:pedestrian |timber |colou?rbond |single )?(?:gates?|posts?|sheets?|palings?|panels?)\b/i.test(after)) continue;
    if (/[:.]$/.test(before) && !unit) continue;
    if (/^\s*(?:am|pm)\b/i.test(after)) continue;
    // times ("3:30"), dates ("22 Oct", "23rd") and phone numbers are not measurements
    if (!unit && /^(?::\d|\s*(?:st|nd|rd|th)\b|\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i.test(after)) continue;
    if (v >= 100000) continue;
    if (unit === "mm") { if (v >= 1200 && v <= 2400) heights.push(v / 1000); continue; }
    if (v >= 1.2 && v <= 2.4) heights.push(v);
    else if (v >= 3 && v <= 500) { lengths.push(v); if (unit) withUnit = true; }
  }
  // "1.8m Colorbond 1.5m": two numbers that both look like heights are a height and a short length (a return, a infill).
  if (!lengths.length && heights.length >= 2) lengths.push(heights.pop());
  return { lengths, heights, withUnit };
}

// How many of something ("2 gates", "two posts"). Measurements are blanked out first, so the 8 in "1.8" or the 26 in "26m" is never taken as a count.
const countBefore = (text, re) => {
  const s = text.replace(/\d+(?:\.\d+)?\s*(?:mm|m|mtrs?|metres?|meters?|lm)\b/gi, " ").replace(/\d+\.\d+/g, " ");
  const m = new RegExp(`(?:(\\d+)|\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b)\\s*(?:x\\s*)?(?:[a-z]+\\s+){0,2}?${re.source}`, "i").exec(s);
  if (m) return m[1] ? Number(m[1]) : NUMBER_WORDS[m[2].toLowerCase()];
  return re.test(s) ? 1 : 0;
};

// text: the notes. hint: { jobType } from the lead, used when the notes don't say what the fence is made of.
// uid: makes ids for the lines. -> { items, jobLength, fenceHeight, jobType, summary[], assumptions[], needsPrice[] }
export function parseSiteNotes(text, hint = {}, uid = () => Math.random().toString(36).slice(2, 10)) {
  const chunks = String(text || "")
    .split(/\n|;|\+(?=\s*\d)|\s+and\s+(?=\d)/i)
    .map((c) => c.trim())
    .filter(Boolean);

  const items = [];
  const summary = [];
  const assumptions = [];
  const needsPrice = [];
  const fences = [];
  let last = null; // style/height of the previous fence line, which a following "6m" carries on from
  const hintStyle = /alumin/i.test(hint.jobType || "") ? "aluminium" : /colou?rbond/i.test(hint.jobType || "") ? "colorbond" : /timber/i.test(hint.jobType || "") ? "timber" : null;
  let removal = null; // { qty, chain }
  let gates = null; // { count, style }
  const extras = [];

  for (const chunk of chunks) {
    const s = chunk.toLowerCase();
    if (/^(?:available from|needs to be done before|checked:|cancelled:|text\b)/.test(s)) continue; // lines the hub writes itself
    const { lengths, heights, withUnit: lengthHasUnit } = readNumbers(s);
    const colorbond = /colou?rbond|steel|corrugated/.test(s);
    const timber = /timber|pine|paling|hardwood|lapped|capped|butted|l\s*&\s*c\b/.test(s);
    const aluminium = /alumin|\bslats?\b/.test(s);
    const slat90 = /\b90\s*mm/.test(s);
    const style = aluminium ? "aluminium" : colorbond ? "colorbond" : timber ? "timber" : null;
    const raked = /\brak(?:e|ed|ing)\b|stepped|on a slope|sloping/.test(s);
    const sleeper = /sleepers?/.test(s) && !/retaining/.test(s);
    const lapped = /lapp|capp|\bl\s*&\s*c\b|\bl\s*and\s*c\b/.test(s);
    const isRemoval = /remov|take down|tear down|old fence|demo|\btip\b/.test(s);
    const isRetaining = /retaining/.test(s);

    if (isRetaining) {
      const len = lengths[0];
      needsPrice.push(`Retaining wall${len ? ` (${len}m)` : ""} — there's no retaining wall template, so add its price.`);
      items.push({ id: uid(), desc: `Retaining wall${len ? ` — ${len}m` : ""}`, qty: len || 1, rate: 0, unit: len ? "m" : "job" });
      continue;
    }

    const wantsGate = /\bgates?\b/.test(s);
    if (wantsGate) {
      const gStyle = style || (last && last.style) || hintStyle;
      gates = { count: (gates?.count || 0) + countBefore(s, /gates?\b/), style: gStyle, wide: !!gates?.wide || /driveway|double|1720|\bwide\b/.test(s), slat90: !!gates?.slat90 || slat90 };
    }
    const posts = /\bposts?\b/.test(s) && !wantsGate && !lengths.length ? countBefore(s, /posts?\b/) : 0;
    if (posts > 0) extras.push({ label: "Timber fence post replacement", qty: posts });
    if (/vegetation|prun(?:e|ing)|\btrees?\b|bushes|hedge|shrubs?/.test(s)) extras.push({ label: "Vegetation pruning/removal", qty: 1 });
    if (/excavator|bobcat|truck hire/.test(s)) extras.push({ label: "Mini excavator/truck hire", qty: 1 });
    if (/deliver/.test(s)) extras.push({ label: "Material delivery", qty: 1 });

    if (isRemoval) {
      removal = { qty: lengths[0] || removal?.qty || 0, chain: removal?.chain || /chain\s*wire|cyclone|mesh/.test(s) };
    }

    // A fence line needs a length. A removal-only chunk ("remove old fence 26m") isn't a new fence.
    // Needs a length, and either a material word or a length written with "m" (so "3 4 5" or a time never makes a fence).
    const makesFence = lengths.length > 0 && (style || lengthHasUnit) && !(isRemoval && !style && !heights.length && !raked && !sleeper);
    if (makesFence) {
      const fStyle = style || last?.style || hintStyle;
      const height = heights[0] ?? last?.height ?? 1.8;
      if (!fStyle) {
        assumptions.push(`${lengths[0]}m — I couldn't tell if it's Colorbond or timber, so I assumed Colorbond. Check the line.`);
      }
      const finalStyle = fStyle || "colorbond";
      const pick = pickFence({ style: finalStyle, height, raked, sleeper, lapped, slat90 });
      const t = template(pick.label);
      if (t) {
        // "inc gate": the measurement includes the gate, so the fence line is that length less the gate opening
        // (about 1m for a pedestrian gate, 1.8m for a driveway or double one). The removal line keeps the full length.
        let fenceQty = lengths[0];
        if (/\binc(?:l|luding|ludes)?\b[^.]*\bgates?\b/.test(s)) {
          const gateCount = Math.max(1, countBefore(s, /gates?\b/));
          const span = (/driveway|double|1720|\bwide\b/.test(s) ? 1.8 : 1) * gateCount;
          if (lengths[0] > span + 0.5) {
            fenceQty = Math.round((lengths[0] - span) * 100) / 100;
            assumptions.push(`${lengths[0]}m includes the gate, so the fence is ${fenceQty}m (${lengths[0]}m less about ${span}m for the gate opening${gateCount > 1 ? "s" : ""}). Change the length if the gate is a different width.`);
          }
        }
        fences.push({ t, qty: fenceQty, style: finalStyle, height, slat90 });
        if (pick.note) assumptions.push(pick.note);
        if (finalStyle === "timber" && !lapped && !/butted/.test(s)) assumptions.push(`${lengths[0]}m timber — I assumed butted paling (say "lapped and capped" if it isn't).`);
        if (heights.length === 0) assumptions.push(`${lengths[0]}m — no height given, so I assumed 1.8m.`);
        last = { style: finalStyle, height, raked };
      }
    }
  }

  // Build the lines in the order a quote reads: removal, fencing, gates, extras.
  const totalLength = fences.reduce((n, f) => n + f.qty, 0);
  if (removal) {
    const qty = removal.qty || totalLength;
    const t = template(removal.chain ? "Timber + chain wire fence removal" : "Timber fence removal");
    if (qty > 0) {
      items.unshift(line(uid, t, qty));
      summary.push(`Remove ${qty}m of old fence`);
    } else {
      assumptions.push("It says to remove the old fence but not how many metres — add the length to the removal line.");
      items.unshift(line(uid, t, 1));
    }
  }
  for (const f of fences) {
    items.push(line(uid, f.t, f.qty));
    summary.push(`${f.qty}m ${f.t.label.replace(/ installation| fence/gi, "").replace(/\s+/g, " ").trim()}`);
  }
  if (gates) {
    const gStyle = gates.style || (fences[0]?.style) || "colorbond";
    if (gStyle === "aluminium") {
      const w = gates.slat90 || fences.some((f) => f.slat90) ? 90 : 65;
      const t = template(gates.wide ? `Aluminium slat driveway gate 1720 x 1800mm (${w}mm slats)` : `Aluminium slat pedestrian gate 930 x 1800mm (${w}mm slats)`);
      items.push(line(uid, t, gates.count));
      summary.push(`${gates.count} aluminium gate${gates.count === 1 ? "" : "s"}`);
      assumptions.push("Aluminium gates are priced as the pre-fabricated 930mm pedestrian gate (1720mm if you said driveway or double), with its hinges and latch — change the line if they're different.");
    } else {
      const t = template(gStyle === "timber" ? "Timber pedestrian gate w/ post attached to house" : "Colorbond pedestrian gate w/ post attached to house");
      items.push(line(uid, t, gates.count));
      summary.push(`${gates.count} gate${gates.count === 1 ? "" : "s"}`);
      assumptions.push("Gates are priced as pedestrian gates with a post attached to the house — change the line if they're different.");
    }
  }
  for (const e of extras) {
    if (items.some((it) => it.tpl === e.label)) continue;
    items.push(line(uid, template(e.label), e.qty));
    summary.push(e.label + (e.qty > 1 ? ` × ${e.qty}` : ""));
  }

  const main = fences[0];
  const jobType = main ? (main.style === "colorbond" ? "Colorbond" : main.style === "aluminium" ? "Aluminium fencing" : "Timber fencing") : gates ? "Gates" : extras.some((e) => /post/i.test(e.label)) ? "Repairs" : null;
  return {
    items,
    jobLength: totalLength || "",
    fenceHeight: main ? String(main.height >= 1.95 && main.height <= 2.05 ? "2" : main.height > 2.05 ? "2.1" : "1.8") : "",
    jobType,
    summary,
    assumptions: [...new Set(assumptions)],
    needsPrice,
  };
}

// ---------- several quotes in one set of notes ----------
// Separate quotes for the same client are written as separate paragraphs (a blank line between them), each optionally starting with a
// heading line that says which is which:
//
//   Right side
//   1.8m Colorbond flat 11.4m Inc timber fence removal
//
//   Left side
//   1.8m Colorbond flat 15.8m Inc timber fence removal
//
// A paragraph that has a fence in it (a length and a material) starts a new quote. A paragraph with no fence in it ("remove the old
// fence", "1 gate", "dog in yard") belongs to the quote above it. Notes with only one fence stay one quote, as before.
const JOB_WORDS = /colou?rbond|steel|timber|alumin|slat|paling|gate|remov|retaining|rak(?:e|ed)|sleeper|vegetation|excavator|deliver|\bpost/i;

// "Right side\n1.8m Colorbond …" -> { title: "Right side", body: "1.8m Colorbond …" }
function splitTitle(block) {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines[0].length <= 50 && !/\d/.test(lines[0]) && !JOB_WORDS.test(lines[0])) {
    return { title: lines[0].replace(/[:\-–]+$/, "").trim(), body: lines.slice(1).join("\n") };
  }
  return { title: "", body: lines.join("\n") };
}

// -> [{ title, items, jobLength, fenceHeight, jobType, summary, assumptions, needsPrice }] — one per quote (always at least one).
export function parseSiteJobs(text, hint = {}, uid = () => Math.random().toString(36).slice(2, 10)) {
  const normalised = String(text || "").replace(/^\s*(?:-{3,}|={3,})\s*$/gm, "");
  const blocks = normalised.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map(splitTitle);
  const hasFence = (body) => parseSiteNotes(body, hint, () => "x").jobLength > 0;
  const groups = [];
  const before = []; // paragraphs ahead of the first fence
  for (const b of blocks) {
    if (hasFence(b.body)) groups.push({ title: b.title, bodies: [b.body] });
    else if (groups.length) groups[groups.length - 1].bodies.push(b.body);
    else before.push(b.body);
  }
  if (groups.length === 0) return [{ title: "", ...parseSiteNotes(text, hint, uid) }];
  groups[0].bodies.unshift(...before);
  return groups.map((g) => ({ title: g.title, ...parseSiteNotes(g.bodies.join("\n"), hint, uid) }));
}
