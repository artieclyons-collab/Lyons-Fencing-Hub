// Turns the quick notes taken on site ("26m 1.8 colorbond raked", "remove old fence", "1 gate") into draft quote lines,
// using the same job templates and rates as the quote form. Pure text in, lines out — nothing is saved or sent.
//
// Write one job per line (or separate with + or ;). Anything it doesn't recognise is simply ignored, so ordinary notes
// ("dog in yard, call before arriving") can sit alongside. It lists what it assumed so you can check before saving.
import { JOB_TEMPLATES } from "./constants";

const NUMBER_WORDS = { a: 1, one: 1, single: 1, two: 2, double: 2, three: 3, four: 4, five: 5 };

const template = (label) => JOB_TEMPLATES.find((t) => t.label === label);
const line = (uid, t, qty) => ({ id: uid(), desc: t.desc, qty, rate: t.rate, unit: t.unit, tpl: t.label });

// Which fence template fits? -> { label, note } (note when we had to settle for the closest one)
export function pickFence({ style, height, raked, sleeper, lapped }) {
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
  return { lengths, heights, withUnit };
}

const countBefore = (s, re) => {
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
  const hintStyle = /colou?rbond/i.test(hint.jobType || "") ? "colorbond" : /timber/i.test(hint.jobType || "") ? "timber" : null;
  let removal = null; // { qty, chain }
  let gates = null; // { count, style }
  const extras = [];

  for (const chunk of chunks) {
    const s = chunk.toLowerCase();
    if (/^(?:available from|needs to be done before|checked:|cancelled:|text\b)/.test(s)) continue; // lines the hub writes itself
    const { lengths, heights, withUnit: lengthHasUnit } = readNumbers(s);
    const colorbond = /colou?rbond|steel|corrugated/.test(s);
    const timber = /timber|pine|paling|hardwood|lapped|capped|butted|l\s*&\s*c\b/.test(s);
    const style = colorbond ? "colorbond" : timber ? "timber" : null;
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
      gates = { count: (gates?.count || 0) + countBefore(s, /gates?\b/), style: gStyle };
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
      const pick = pickFence({ style: finalStyle, height, raked, sleeper, lapped });
      const t = template(pick.label);
      if (t) {
        fences.push({ t, qty: lengths[0], style: finalStyle, height });
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
    const t = template(gStyle === "timber" ? "Timber pedestrian gate w/ post attached to house" : "Colorbond pedestrian gate w/ post attached to house");
    items.push(line(uid, t, gates.count));
    summary.push(`${gates.count} gate${gates.count === 1 ? "" : "s"}`);
    assumptions.push("Gates are priced as pedestrian gates with a post attached to the house — change the line if they're different.");
  }
  for (const e of extras) {
    if (items.some((it) => it.tpl === e.label)) continue;
    items.push(line(uid, template(e.label), e.qty));
    summary.push(e.label + (e.qty > 1 ? ` × ${e.qty}` : ""));
  }

  const main = fences[0];
  const jobType = main ? (main.style === "colorbond" ? "Colorbond" : "Timber fencing") : gates ? "Gates" : extras.some((e) => /post/i.test(e.label)) ? "Repairs" : null;
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
