// Turns the quick notes taken on site ("26m 1.8 colorbond raked", "remove old fence", "1 gate") into draft quote lines,
// using the same job templates and rates as the quote form. Pure text in, lines out — nothing is saved or sent.
//
// Write one job per line (or separate with + or ;). Several quotes for the same client go in the same notes, each in its own paragraph
// (a blank line between them, optionally with a heading line like "Left side"): see parseSiteJobs.
// Write one job per line (or separate with + or ;). Anything it doesn't recognise is simply ignored, so ordinary notes
// ("dog in yard, call before arriving") can sit alongside. It lists what it assumed so you can check before saving.
import { JOB_TEMPLATES } from "./constants";
import { detectFacing } from "./palingSide";
import { postWording } from "./logic";

const NUMBER_WORDS = { a: 1, one: 1, single: 1, two: 2, double: 2, three: 3, four: 4, five: 5 };

const template = (label) => JOB_TEMPLATES.find((t) => t.label === label);
const line = (uid, t, qty) => ({ id: uid(), desc: t.desc, qty, rate: t.rate, unit: t.unit, tpl: t.label });

// Which fence template fits? -> { label, note } (note when we had to settle for the closest one)
export function pickFence({ style, height, raked, sleeper, lapped, slat90, future, goodNeighbour }) {
  if (style === "aluminium" && future) {
    const label = "Future Fence aluminium batten fence installation 1.8m";
    return Number(height) > 1.85 ? { label, note: "Future Fence panels come in 900, 1200, 1500 and 1800mm: I used the 1.8m template, so check the height." } : { label };
  }
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
  if (goodNeighbour) return { label: `Good neighbour timber fence installation ${size}` };
  return { label: lapped ? `Lapped & capped timber fence installation ${size}` : `Butted paling timber fence installation ${size}` };
}

const NUM = /(\d+(?:\.\d+)?)\s*(mm|m|mtrs?|metres?|meters?|lm)?(?!\d|\.\d)/gi;

// "$250 each", "$250 per post", "$185/m" -> { amount: 250, total: false }; "$1500 total" / "$1500 for the lot" -> { amount: 1500, total: true }. ex GST, like every rate on a quote.
const PRICE = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(total|all\s*up|in\s*total|for\s+the\s+(?:lot|job|two|three|both))?/i;
export function priceIn(text) {
  const m = PRICE.exec(String(text || ""));
  const amount = m ? Number(m[1].replace(/,/g, "")) : NaN;
  return Number.isFinite(amount) && amount > 0 ? { amount, total: !!m[2] } : null;
}
// the rate for a line of `qty` when the notes gave a price (a total is spread over the quantity)
const pricedLine = (it, p) => (p ? { ...it, rate: priced(p, it.qty, it.rate) } : it);
// the price and the words that go with it ("$250 each", "$185/m", "$500 total"), which are taken out before lengths and counts are read
const PRICE_WORDS = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s*(?:total|all\s*up|in\s*total|for\s+the\s+(?:lot|job|two|three|both)|each|ea\b|\/\s*[a-z]+|per\s+[a-z]+|a\s+(?:metre|meter|post|gate|panel)))?/gi;
// -> { which: "last", unit: "panel", size: 2100 | null } when only one panel / bay / section is raked, else null
const RAKE_PART = [
  /\b(?:except|but|apart\s+from|besides|excluding)\b[^.]*?\brak(?:e|ed|ing)\b[^.]*?\b(last|first|end|final|corner)\s+(panel|bay|section)\b/i,
  /\b(last|first|end|final|corner)\s+(panel|bay|section)\b[^.]*?\brak(?:e|ed|ing)\b/i,
  /\brak(?:e|ed|ing)\s+(?:the\s+)?(last|first|end|final|corner)\s+(panel|bay|section)\b/i,
];
export function rakedPartOf(text) {
  const t = String(text || "");
  for (const re of RAKE_PART) {
    const m = re.exec(t);
    if (!m) continue;
    const size = /(\d{4})\s*mm\s*(?:colou?rbond\s+)?(?:sheet|panel)/i.exec(t);
    return { which: m[1].toLowerCase(), unit: m[2].toLowerCase(), size: size ? Number(size[1]) : null };
  }
  return null;
}
const priced = (p, qty, fallback) => (!p ? fallback : p.total ? Math.round((p.amount / Math.max(1, Number(qty) || 1)) * 100) / 100 : p.amount);

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
    // ("20m palings facing the neighbour" is a length followed by a note about the palings, so a length with a unit before "palings" stays)
    if (/^\s*(?:x\s*)?(?:pedestrian |timber |colou?rbond |single )?(?:gates?|posts?|sheets?|palings?|panels?)\b/i.test(after) && !(unit && /^\s*palings?\b/i.test(after))) continue;
    if (/[:.]$/.test(before) && !unit) continue;
    if (/^\s*(?:am|pm)\b/i.test(after)) continue;
    // times ("3:30"), dates ("22 Oct", "23rd") and phone numbers are not measurements
    if (!unit && /^(?::\d|\s*(?:st|nd|rd|th)\b|\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i.test(after)) continue;
    if (v >= 100000) continue;
    if (unit === "mm") { if (v >= 1200 && v <= 2400 && !/^\s*(?:colou?rbond\s+)?(?:sheets?|panels?)\b/i.test(after)) heights.push(v / 1000); continue; }
    if (v >= 1.2 && v <= 2.4) heights.push(v);
    else if ((v >= 3 || (unit && v > 2.4 && !/^\s*(?:high|height|tall)\b/i.test(after))) && v <= 500) { lengths.push(v); if (unit) withUnit = true; }
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

const explicitCount = (text, re) => {
  const s = text.replace(/\d+(?:\.\d+)?\s*(?:mm|m|mtrs?|metres?|meters?|lm)\b/gi, " ").replace(/\d+\.\d+/g, " ");
  const m = new RegExp(`(?:(\\d+)|\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b)\\s*(?:x\\s*)?(?:[a-z]+\\s+){0,2}?${re.source}`, "i").exec(s);
  return m ? (m[1] ? Number(m[1]) : NUMBER_WORDS[m[2].toLowerCase()]) : 0;
};

// A line that gives only a length ("23.5m raked") followed by a line that gives only the fence ("Colorbond w sleeper 2m") is one job.
const STYLE_WORD = /colou?rbond|steel|timber|alumin|slat|paling|butted|lapped/;
function mergeSplitJobs(chunks) {
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const n = chunks[i + 1];
    if (n) {
      const a = c.toLowerCase();
      const b = n.toLowerCase();
      const lengthOnly = readNumbers(a).lengths.length > 0 && !STYLE_WORD.test(a) && !/gate|remov|\bposts?\b/.test(a);
      const fenceOnly = STYLE_WORD.test(b) && readNumbers(b).lengths.length === 0;
      if (lengthOnly && fenceOnly) { out.push(`${c} ${n}`); i++; continue; }
    }
    out.push(c);
  }
  return out;
}

// text: the notes. hint: { jobType } from the lead, used when the notes don't say what the fence is made of.
// uid: makes ids for the lines. -> { items, jobLength, fenceHeight, jobType, summary[], assumptions[], needsPrice[] }
export function parseSiteNotes(text, hint = {}, uid = () => Math.random().toString(36).slice(2, 10)) {
  const chunks = mergeSplitJobs(
    String(text || "")
      .split(/\n|;|\+(?=\s*\d)|\s+and\s+(?=\d)/i)
      .map((c) => c.trim())
      .filter(Boolean)
  );
  const remarks = []; // what's in brackets ("up to the second shed") — site detail worth seeing when the quote is drafted

  const items = [];
  const summary = [];
  const assumptions = [];
  const needsPrice = [];
  const fences = [];
  let last = null; // style/height of the previous fence line, which a following "6m" carries on from
  const hintStyle = /alumin/i.test(hint.jobType || "") ? "aluminium" : /colou?rbond/i.test(hint.jobType || "") ? "colorbond" : /timber/i.test(hint.jobType || "") ? "timber" : null;
  let removal = null; // { qty, chain }
  let gates = null; // [{ count, style, future, wide, slat90, attached: "" | "house" | "fence" }], one per kind of gate
  const extras = [];

  for (const chunk of chunks) {
    for (const mm of chunk.matchAll(/\(([^)]+)\)/g)) if (!/^was\b/i.test(mm[1].trim())) remarks.push(mm[1].trim());
    const s0 = chunk.toLowerCase();
    const price = priceIn(s0);
    const priceAt = s0.search(/\$/);
    const s = s0.replace(PRICE_WORDS, " ");
    if (/^(?:available from|needs to be done before|checked:|cancelled:|text\b)/.test(s)) continue; // lines the hub writes itself
    const { lengths, heights, withUnit: lengthHasUnit } = readNumbers(s);
    const colorbond = /colou?rbond|steel|corrugated/.test(s);
    const timber = /timber|pine|paling|hardwood|lapped|capped|butted|l\s*&\s*c\b/.test(s);
    const future = /future\s*-?\s*fence|\bbattens?\b/.test(s); // Future Fence prefabricated aluminium batten panels
    const aluminium = /alumin|\bslats?\b/.test(s) || future;
    const slat90 = /\b90\s*mm/.test(s);
    const style = aluminium ? "aluminium" : colorbond ? "colorbond" : timber ? "timber" : null;
    const rakedPart = rakedPartOf(s); // only one panel is raked: the fence itself is flat
    const raked = !rakedPart && /\brak(?:e|ed|ing)\b|stepped|on a slope|sloping/.test(s);
    const sleeper = /sleepers?/.test(s) && !/retaining/.test(s);
    const lapped = /lapp|capp|\bl\s*&\s*c\b|\bl\s*and\s*c\b/.test(s);
    // "good neighbour" is the lapped & capped fence without the capping, unless the notes say it's capped too
    const goodNeighbour = /good\s*-?\s*neighbou?r/.test(s) && !/\bcapp(?:ed|ing)\b|\bcap\b|\bl\s*&\s*c\b|\bl\s*and\s*c\b/.test(s);
    // "no removal", "without removal", "removal not needed", "don't need the old fence removed" mean there is NO removal line
    const noRemoval = /\b(?:no|without|not|skip|excluding|exclude[sd]?)\s+(?:\w+\s+){0,3}?(?:remov\w*|take\s*down|tear\s*down|demo\w*|tip(?:ping)?|old\s+fence)\b|\b(?:remov\w*|demo\w*)\s+(?:is\s+|are\s+)?(?:not|isn't)\s+(?:needed|required|wanted|necessary)|\b(?:don't|doesn't|do not)\s+need\s+(?:\w+\s+){0,3}?(?:remov\w*|take down|demo\w*)/.test(s);
    const isRemoval = !noRemoval && /remov|take down|tear down|old fence|demo|\btip\b/.test(s);
    const isRetaining = /retaining/.test(s);

    if (isRetaining) {
      const len = lengths[0];
      needsPrice.push(`Retaining wall${len ? ` (${len}m)` : ""} — there's no retaining wall template, so add its price.`);
      items.push({ id: uid(), desc: `Retaining wall${len ? ` — ${len}m` : ""}`, qty: len || 1, rate: 0, unit: len ? "m" : "job" });
      continue;
    }

    // A line with a counted post that only mentions a gate ("1 post install for fence gate repair") is a post for the gate, not a gate to supply.
    const postN = /\bposts?\b/.test(s) ? countBefore(s, /posts?\b/) : 0;
    const gateReturnPost = postN > 0 && /\bgates?\b/.test(s) && explicitCount(s, /gates?\b/) === 0 && !lengths.length;
    const wantsGate = /\bgates?\b/.test(s) && !gateReturnPost;
    if (wantsGate) {
      const gStyle = style || (last && last.style) || hintStyle;
      const gFuture = gStyle === "aluminium" && (future || (!style && !!last?.future));
      gates = gates || [];
      let g = gates.find((x) => x.style === gStyle && !!x.future === gFuture);
      if (!g) { g = { count: 0, style: gStyle, future: gFuture, wide: false, slat90: false, attached: "" }; gates.push(g); }
      g.count += countBefore(s, /gates?\b/);
      if (price && (!lengths.length || (priceAt > 0 && s0.lastIndexOf("gate", priceAt) > Math.max(-1, ...[...s0.slice(0, priceAt).matchAll(/\d(?:\.\d+)?\s*m\b/g)].map((m) => m.index))))) g.price = price;
      g.wide = g.wide || /driveway|double|1720|\bwide\b/.test(s);
      g.slat90 = g.slat90 || slat90;
      g.attached = g.attached || (/\b(?:attached|against|off)\b[^.]*\b(?:house|wall)\b/.test(s) ? "house" : /\b(?:attached|against|off)\b[^.]*\bfence\b/.test(s) ? "fence" : "");
    }
    const posts = /\bposts?\b/.test(s) && !wantsGate && !lengths.length ? postN : 0;
    if (posts > 0) {
      const lbl = gateReturnPost ? "Timber gate return post installation" : "Timber fence post replacement";
      const have = extras.find((x) => x.label === lbl);
      if (have) { have.qty += posts; have.price = have.price || price; } else extras.push({ label: lbl, qty: posts, price });
      if (gateReturnPost) assumptions.push("A post for the gate (so it isn't attached to the fence) is priced like a post replacement: change the price if it's different.");
    }
    if (/vegetation|prun(?:e|ing)|\btrees?\b|bushes|hedge|shrubs?/.test(s)) extras.push({ label: "Vegetation pruning/removal", qty: 1 });
    if (/excavator|bobcat|truck hire/.test(s)) extras.push({ label: "Mini excavator/truck hire", qty: 1 });
    if (/deliver/.test(s)) extras.push({ label: "Material delivery", qty: 1 });

    if (isRemoval) {
      removal = { qty: lengths[0] || removal?.qty || 0, chain: removal?.chain || /chain\s*wire|cyclone|mesh/.test(s), boundary: removal?.boundary || boundaryOf(chunk) };
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
      const isFuture = finalStyle === "aluminium" && (future || (!aluminium && last?.future));
      const pick = pickFence({ style: finalStyle, height, raked, sleeper, lapped, slat90, future: isFuture, goodNeighbour: finalStyle === "timber" && goodNeighbour });
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
        const gatePrice = !!price && wantsGate && priceAt > 0 && s0.lastIndexOf("gate", priceAt) > Math.max(-1, ...[...s0.slice(0, priceAt).matchAll(/\d(?:\.\d+)?\s*m\b/g)].map((m) => m.index));
        const fencePrice = gatePrice ? null : price;
        // the sentence that carries your note into the line's description
        const remark = rakedPart
          ? finalStyle === "colorbond"
            ? `The ${rakedPart.which} ${rakedPart.unit} will be raked, using a ${rakedPart.size || 2100}mm Colorbond sheet cut on a rake to suit the gradient of the land.`
            : `The ${rakedPart.which} ${rakedPart.unit} will be raked to suit the gradient of the land.`
          : "";
        if (rakedPart) assumptions.push(`Only the ${rakedPart.which} ${rakedPart.unit} is raked, so this is the flat fence with that panel in its description: check the price for the raked panel.`);
        fences.push({ t, qty: fenceQty, style: finalStyle, height, slat90, future: isFuture, boundary: boundaryOf(chunk), price: fencePrice, remark });
        if (fencePrice) assumptions.push(`Used your price of $${fencePrice.total ? Math.round((fencePrice.amount / Math.max(1, fenceQty)) * 100) / 100 : fencePrice.amount} a metre for the ${fenceQty}m of fence (the template price is $${t.rate}).`);
        if (pick.note) assumptions.push(pick.note);
        if (raked && finalStyle === "timber") assumptions.push("There's no raked timber template, so I used the standard timber one — check the wording and rate for the rake.");
        if (finalStyle === "timber" && goodNeighbour) assumptions.push("Good neighbour is priced $5 a metre under lapped and capped, without the capping: write 'capped' in the notes if it needs the capping.");
        if (finalStyle === "timber" && !lapped && !goodNeighbour && !/butted/.test(s)) assumptions.push(`${lengths[0]}m timber — I assumed butted paling (say "lapped and capped" if it isn't).`);
        if (heights.length === 0) assumptions.push(`${lengths[0]}m — no height given, so I assumed 1.8m.`);
        last = { style: finalStyle, height, raked, future: isFuture, goodNeighbour: finalStyle === "timber" && goodNeighbour };
      }
    }
  }

  // Build the lines in the order a quote reads: removal, fencing, gates, extras.
  const totalLength = fences.reduce((n, f) => n + f.qty, 0);
  if (removal) {
    const qty = removal.qty || totalLength;
    const t = template(removal.chain ? "Timber + chain wire fence removal" : "Timber fence removal");
    if (qty > 0) {
      items.unshift(removal.boundary ? withBoundary(line(uid, t, qty), removal.boundary) : line(uid, t, qty));
      summary.push(`Remove ${qty}m of old fence`);
    } else {
      assumptions.push("It says to remove the old fence but not how many metres — add the length to the removal line.");
      items.unshift(line(uid, t, 1));
    }
  }
  for (const f of fences) {
    const fl = line(uid, f.t, f.qty);
    fl.rate = priced(f.price, f.qty, fl.rate);
    const withB = f.boundary ? withBoundary(fl, f.boundary) : fl;
    items.push(f.remark ? { ...withB, desc: `${withB.desc} ${f.remark}` } : withB);
    summary.push(`${f.qty}m ${f.t.label.replace(/ installation| fence/gi, "").replace(/\s+/g, " ").trim()}`);
  }
  const gateGroups = gates || [];
  for (const gates of gateGroups) {
    const gStyle = gates.style || (fences[0]?.style) || "colorbond";
    if (gStyle === "aluminium" && gates.future) {
      items.push(pricedLine(line(uid, template("Future Fence aluminium batten pedestrian gate 1.8m (up to 1180mm wide)"), gates.count), gates.price));
      summary.push(`${gates.count} Future Fence gate${gates.count === 1 ? "" : "s"}`);
      assumptions.push("Future Fence gates are priced as the batten pedestrian gate (up to 1180mm wide, 1.8m high) with a LokkLatch and self-closing hinges: change the line if it's wider or a driveway gate.");
    } else if (gStyle === "aluminium") {
      const w = gates.slat90 || fences.some((f) => f.slat90) ? 90 : 65;
      const t = template(gates.wide ? `Aluminium slat driveway gate 1720 x 1800mm (${w}mm slats)` : `Aluminium slat pedestrian gate 930 x 1800mm (${w}mm slats)`);
      items.push(pricedLine(line(uid, t, gates.count), gates.price));
      summary.push(`${gates.count} aluminium gate${gates.count === 1 ? "" : "s"}`);
      assumptions.push("Aluminium gates are priced as the pre-fabricated 930mm pedestrian gate (1720mm if you said driveway or double), with its hinges and latch — change the line if they're different.");
    } else {
      // a normal gate (two posts) unless the notes say a post attaches to the house or the fence
      const mat = gStyle === "timber" ? "Timber" : "Colorbond";
      const t = template(gates.attached ? `${mat} pedestrian gate w/ post attached to ${gates.attached}` : `${mat} pedestrian gate`);
      items.push(pricedLine(line(uid, t, gates.count), gates.price));
      summary.push(`${gates.count} gate${gates.count === 1 ? "" : "s"}`);
      assumptions.push(gates.attached ? `Gates are priced as pedestrian gates with one post attached to the ${gates.attached} — change the line if they're different.` : "Gates are priced as normal pedestrian gates with two posts set in concrete — if a post attaches to the fence or house, swap the line for the \"post attached\" gate.");
    }
  }
  for (const e of extras) {
    if (items.some((it) => it.tpl === e.label)) continue;
    const el = line(uid, template(e.label), e.qty);
    el.desc = postWording(el.desc, el.qty);
    if (e.price) { el.rate = priced(e.price, e.qty, el.rate); assumptions.push(`Used your price of $${el.rate} each for ${e.label.toLowerCase()} (the template price is $${template(e.label).rate}).`); }
    items.push(el);
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
    remarks: [...new Set(remarks)],
    boundaries: fences.map((f) => f.boundary || ""),
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
// - A paragraph that has a fence in it (a length and a material) starts a new quote. A paragraph with no fence in it ("remove the old
//   fence", "1 gate", "dog in yard") belongs to the quote above it. Notes with only one fence stay one quote.
// - "Colorbond or timber butted w sleeper 2m" is two options, so it makes two quotes (everything else on the line applies to both).
// - A paragraph that says it's its own quote ("Another quote to take off the hinges and rehang the gate…") becomes a quote with that
//   job as a custom line, to be priced by hand — there's no template for it.
const JOB_WORDS = /colou?rbond|steel|timber|alumin|slat|paling|gate|remov|retaining|rak(?:e|ed)|sleeper|vegetation|excavator|deliver|\bpost/i;
const STYLE_PHRASE = "(?:(?:colou?rbond|steel|timber|alumin(?:ium)?(?:\\s+slats?)?|butted|lapped(?:\\s*(?:&|and)\\s*capped)?|capped|paling)\\b\\s*)+";
const OPTION = new RegExp(`(${STYLE_PHRASE})\\bor\\s+(${STYLE_PHRASE})`, "i");
const OWN_QUOTE = /^(?:another|separate|new|extra|also|second|third|one more)\s+(?:quote|job)\b\s*(?:to|for|is|:|-)?\s*/i;
const TASK_VERB = /\b(?:take off|rehang|re-hang|hang|repair|replace|fix|rebuild|relocate|move|extend|install|supply|build|paint|clean|modify|adjust|raise|lower|trim)\b/i;

// "Right side\n1.8m Colorbond …" -> { title: "Right side", body: "1.8m Colorbond …" }
function splitTitle(block) {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines[0].length <= 50 && !/\d/.test(lines[0]) && !JOB_WORDS.test(lines[0])) {
    return { title: lines[0].replace(/[:\-–]+$/, "").trim(), body: lines.slice(1).join("\n") };
  }
  return { title: "", body: lines.join("\n") };
}

// "Colorbond or timber butted w sleeper 2m Inc removal" -> one body per option, the rest of the line shared:
//   ["Colorbond w sleeper 2m Inc removal", "timber butted w sleeper 2m Inc removal"]
function expandOptions(body, depth = 0) {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = depth < 3 ? OPTION.exec(lines[i]) : null;
    if (!m) continue;
    const all = [m[1], m[2]].flatMap((g) => expandOptions([...lines.slice(0, i), lines[i].replace(m[0], `${g.trim()} `).replace(/\s+/g, " ").trim(), ...lines.slice(i + 1)].join("\n"), depth + 1));
    return [...new Set(all)]; // "A or B or C" reaches C by two routes
  }
  return [body];
}

const styleWord = (jobType) => (jobType === "Colorbond" ? "Colorbond" : jobType === "Aluminium fencing" ? "aluminium" : jobType === "Timber fencing" ? "timber" : "");
const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// Which boundary a paragraph of notes is about ("Back boundary 23.9m", "47.1m right boundary", "left and right boundaries") ->
// "back boundary" / "left and right boundaries", or "". It goes into the fence line's wording and the quote's title.
const SIDE = "(?:back|rear|left|right|front|side|north|south|east|west)";
const BOUNDARY = new RegExp(`\\b(?:the\\s+)?(${SIDE}(?:(?:\\s*,\\s*|\\s+and\\s+|\\s*&\\s*)${SIDE})*)(?:[\\s-]+hand)?(?:\\s+side)?\\s+(boundary|boundaries)\\b`, "i");
export function boundaryOf(text) {
  const t = String(text || "");
  let m = t.match(BOUNDARY);
  if (!m) {
    // "11m front aluminium future fence", "left colorbond fence", "fence along the rear": the side is named without the word boundary
    const loose = t.match(new RegExp(`\\b(${SIDE})\\s+(?:(?:colou?rbond|aluminium|alu|timber|chain\\s*wire|future|batten|slat|lapped|capped|butted|paling|steel|flat|raked|new|existing|old)\\s+){0,4}fence\\b`, "i")) || t.match(/\bfence\s+(?:on|along|at)\s+the\s+(front|rear|back|left|right)\b/i);
    if (!loose) return "";
    m = [loose[0], loose[1], "boundary"];
  }
  // "back" is written as "rear" on the quote, which reads more professionally
  const sides = m[1].toLowerCase().replace(/\bback\b/g, "rear").replace(/\s*,\s*/g, ", ").replace(/\s*&\s*/g, " and ").replace(/\s+/g, " ");
  return `${sides} ${/ and |,/.test(sides) || /boundaries/i.test(m[2]) ? "boundaries" : "boundary"}`;
}

// "…timber fence at 1.8 metres high…" -> "…timber fence along the back boundary at 1.8 metres high…"; a removal line gets it on the end.
function withBoundary(item, boundary) {
  const d = String(item.desc || "");
  if (/^Supply and installation of .* fence(?: panels)? at /.test(d)) return { ...item, desc: d.replace(/ fence( panels)? at /, ` fence$1 along the ${boundary} at `) };
  if (/^Removal and disposal of existing .*fence\.?$/.test(d)) return { ...item, desc: d.replace(/fence\.?$/, `fence along the ${boundary}.`) };
  return item;
}

// A paragraph that is a job of its own with no template: -> the job as a sentence, or null.
function ownQuoteText(body, hint, parse) {
  const flat = body.replace(/\s+/g, " ").trim();
  if (OWN_QUOTE.test(flat)) return flat.replace(OWN_QUOTE, "");
  if (flat.split(" ").length >= 6 && TASK_VERB.test(flat) && parse(body, hint, () => "x").items.length === 0) return flat;
  return null;
}

// -> [{ title, items, jobLength, fenceHeight, jobType, summary, assumptions, needsPrice, remarks, service? }] — one per quote (always at least one).
export function parseSiteJobs(text, hint = {}, uid = () => Math.random().toString(36).slice(2, 10)) {
  const normalised = String(text || "").replace(/^\s*(?:-{3,}|={3,})\s*$/gm, "");
  // A first line like "3 quotes" or "three quotes:" says how many quotes the notes hold. If the paragraphs don't add up to that but the
  // lines do (one quote per line), each line is a quote.
  let declared = 0;
  let body0 = normalised;
  {
    const lines0 = normalised.split("\n");
    const first = lines0.findIndex((l) => l.trim());
    const m = first >= 0 ? new RegExp(`^\\s*(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s+(?:separate\\s+)?quotes?\\b\\s*[:\\-–]?\\s*$`, "i").exec(lines0[first]) : null;
    if (m) {
      declared = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
      body0 = lines0.slice(first + 1).join("\n");
    }
  }
  let blocks = body0.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map(splitTitle);
  if (declared && blocks.length !== declared) {
    const eachLine = body0.split("\n").map((l) => l.trim()).filter((l) => l && !/^(?:available from|needs to be done before|checked:|cancelled:|text\b|updates \(|bill(?:ed)? to\s*:)/i.test(l));
    // the lines add up to the number said, or (when some are missing) there are at least more lines than paragraphs and no more than said
    if (eachLine.length === declared || (blocks.length < declared && eachLine.length > blocks.length && eachLine.length < declared)) blocks = eachLine.map(splitTitle);
  }
  // A paragraph starts a new quote when it has a fence in it, or posts to repair or put in (`also 2 posts` / `plus 2 posts` stay with the quote above).
  const hasFence = (body) => {
    const p = parseSiteNotes(body, hint, () => "x");
    if (p.jobLength > 0) return true;
    return !/^\s*(?:also|plus|and|as well|including|include)\b/i.test(body) && p.items.some((it) => /^Timber (?:fence post replacement|gate return post installation)$/.test(it.tpl || ""));
  };
  const groups = [];
  const before = []; // paragraphs ahead of the first fence
  for (const b of blocks) {
    const own = ownQuoteText(b.body, hint, parseSiteNotes);
    if (own) { groups.push({ title: b.title, service: own }); continue; }
    const variants = expandOptions(b.body);
    if (variants.some(hasFence)) {
      for (const v of variants) groups.push({ title: b.title, bodies: [v], option: variants.length > 1 });
      continue;
    }
    const host = [...groups].reverse().find((g) => g.bodies);
    if (host) host.bodies.push(b.body);
    else before.push(b.body);
  }
  if (groups.length === 0) return [{ title: "", ...parseSiteNotes(text, hint, uid) }];
  const firstWithBodies = groups.find((g) => g.bodies);
  if (firstWithBodies) firstWithBodies.bodies.unshift(...before);

  const many = groups.length > 1;
  const quotes = groups.map((g) => {
    if (g.service) {
      let sentence = capital(g.service.replace(/\s+/g, " ").trim());
      if (!/[.!?]$/.test(sentence)) sentence += ".";
      const short = /re-?hang/i.test(sentence) ? "Gate rehang" : sentence.split(" ").slice(0, 4).join(" ").replace(/[.,]$/, "");
      return {
        title: g.title || short,
        items: [{ id: uid(), desc: sentence, qty: 1, rate: 0, unit: "job" }],
        jobLength: "",
        fenceHeight: "",
        jobType: /gate/i.test(sentence) ? "Gates" : "Other",
        summary: [sentence.replace(/\.$/, "")],
        assumptions: [],
        needsPrice: [`${short} — there's no template for this job, so add its price.`],
        remarks: [],
        service: true,
      };
    }
    const parsed = parseSiteNotes(g.bodies.join("\n"), hint, uid);
    const word = capital(styleWord(parsed.jobType));
    const postTitle = parsed.items
      .filter((it) => /^Timber (?:fence post replacement|gate return post installation)$/.test(it.tpl || ""))
      .map((it) => (it.tpl === "Timber gate return post installation" ? `Gate return ${Number(it.qty) === 1 ? "post" : "posts"}` : `${it.qty} ${Number(it.qty) === 1 ? "post" : "posts"} repair`))
      .join(" + ");
    const auto = parsed.jobLength ? `${parsed.jobLength}m${word ? ` ${word}` : ""}` : postTitle;
    // (the boundary is on each line already; the quote is named after it when every fence line in it is for the same one)
    const bs = parsed.boundaries || [];
    const boundary = bs.length && bs.every((b) => b && b === bs[0]) ? bs[0] : "";
    const autoTitle = boundary ? `${capital(boundary)}${auto ? ` — ${auto}` : ""}` : auto;
    const title = g.title ? (g.option && word ? `${g.title} — ${word}` : g.title) : many || boundary ? autoTitle : "";
    return { title, ...parsed, palingSide: detectFacing(g.bodies.join("\n")) };
  });

  // A big job (this lead's notes add up to BIG_JOB_METRES or more of fence) gets $5 a metre off the fence price, so a 114m lapped and capped
  // job is $190/m instead of $195/m. Only the new fence lines (not removal, gates or extras).
  const totalMetres = quotes.reduce((s, q) => s + (q.service ? 0 : Number(q.jobLength) || 0), 0);
  if (totalMetres >= BIG_JOB_METRES) {
    for (const q of quotes) {
      if (q.service) continue;
      let cut = false;
      q.items = q.items.map((it) => {
        if (String(it.unit) !== "m" || !/^Supply and installation of .* fence/.test(it.desc || "") || !(Number(it.rate) > BIG_JOB_OFF)) return it;
        const tpl = JOB_TEMPLATES.find((x) => x.label === it.tpl);
        if (tpl && Number(it.rate) !== Number(tpl.rate)) return it; // a price you wrote in the notes stays as written
        cut = true;
        return { ...it, rate: Number(it.rate) - BIG_JOB_OFF };
      });
      if (cut) q.assumptions = [...(q.assumptions || []), `Big job (${Math.round(totalMetres * 10) / 10}m of fence in total): $${BIG_JOB_OFF} a metre off the fence price.`];
    }
  }
  if (declared && quotes.length !== declared && quotes[0]) {
    quotes[0].assumptions = [...(quotes[0].assumptions || []), `Your notes say ${declared} quote${declared === 1 ? "" : "s"} but I made ${quotes.length}: check the notes (one quote per paragraph, or one per line under the "${declared} quotes" line).`];
  }
  return quotes;
}

export const BIG_JOB_METRES = 50; // total fence length from where the discount applies
export const BIG_JOB_OFF = 5; // dollars off per metre (ex GST)
