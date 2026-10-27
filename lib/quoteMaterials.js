// Works out the materials a quote needs by reading its own lines, section by section, instead of one length typed into the calculator.
//
// Each per-metre install line is a section: its material (Colorbond, timber, aluminium), height, whether it's raked, on sleepers (and how
// tall they are: "300mm of treated pine timber sleepers" is 1.5 sleepers a bay), lapped & capped / good neighbour, the sheet height
// the line names ("1800mm high Colorbond sheets"), and how deep the holes are ("900mm deep concrete footings"). Gates are added to the
// first section of the same material. Each section is priced by the same calculator as before and the lists are added together.
// Anything the quote doesn't say is left at the usual (flat, 600mm holes, no sleepers), and the screen shows what it read so it can be checked.
import { calcMaterials, matchMaterialRate, uid } from "./logic";

// "2 x 2100mm sheets", "two 2100mm sheets", "2 sheets that are 2100mm": a bay that needs sheets of another height than the rest
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };
function specialSheets(t) {
  const out = [];
  const add = (c, mm) => { const count = Number(c) || WORDS[String(c).toLowerCase()] || 0; if (count > 0 && mm >= 1200 && mm <= 3000) out.push({ count, mm }); };
  for (const m of t.matchAll(/\b(\d+|one|two|three|four|five)\s*(?:x|×)?\s*(\d{4})\s*mm\s+(?:high\s+)?(?:colou?rbond\s+)?sheets?/gi)) add(m[1], Number(m[2]));
  for (const m of t.matchAll(/\b(\d+|one|two|three|four|five)\s+(?:colou?rbond\s+)?sheets?\s+(?:that\s+are|at|of|in|cut\s+from)\s+(\d{4})\s*mm/gi)) add(m[1], Number(m[2]));
  return out;
}

const text = (it) => `${it.tpl || ""} ${it.desc || ""}`;
const first = (re, s) => re.exec(s)?.[1];

export function sectionsFromQuote(form) {
  const items = form.items || [];
  const all = `${items.map(text).join(" ")} ${form.notes || ""}`;
  const depths = [...all.matchAll(/(\d{3,4})\s*mm\s+deep/gi)].map((m) => Number(m[1])).filter((d) => d >= 600 && d <= 1500);
  const quoteDepth = depths.length ? Math.max(...depths) : 600;
  const jobStyle = /alumin/i.test(form.jobType || "") ? "aluminium" : /colou?rbond/i.test(form.jobType || "") ? "colorbond" : "timber";

  const sections = [];
  for (const it of items) {
    const t = text(it);
    const len = Number(it.qty) || 0;
    if (it.unit !== "m" || len <= 0 || !/install/i.test(t) || /^\s*removal/i.test(it.desc || "")) continue;

    const style = /alumin/i.test(t) ? "aluminium" : /colou?rbond/i.test(t) ? "colorbond" : /timber|paling|hardwood/i.test(t) ? "timber" : jobStyle;
    const own = first(/(\d{3,4})\s*mm\s+deep/i, t);
    const holeDepth = own && Number(own) >= 600 && Number(own) <= 1500 ? Number(own) : quoteDepth;
    const raked = /\brak(?:e|ed|ing)\b/i.test(t);
    const sleeper = /sleepers?/i.test(t);
    const sleeperMm = sleeper ? Number(first(/(\d{3})\s*mm\s+(?:of\s+)?(?:treated\s+pine\s+)?(?:timber\s+)?sleepers?/i, t)) || 200 : 0;

    const params = { style, length: len, holeDepth, raked, sleeper, sleeperMm };
    const bits = [`${len}m`];
    if (style === "aluminium") {
      const mm = Number(first(/(\d{3,4})\s*mm\s+high/i, t));
      const wall = /wall|base plate/i.test(t);
      params.height = mm ? mm / 1000 : Number(form.fenceHeight) || 1.8;
      params.slatWidth = /\b90\s*mm/i.test(t) ? 90 : 65;
      params.onWall = wall;
      params.gap = wall && params.height < 1 ? 20 : 10;
      // panel width: "5 panels" on the line (the length is shared between them), else "approximately 2.3 metres apart"
      const nPanels = Number(first(/(\d+)\s*panels?\b/i, t));
      const apart = Number(first(/(\d(?:\.\d+)?)\s*metres?\s+apart/i, t));
      if (nPanels > 0) params.panelWidth = len / nPanels;
      else if (apart > 0) params.panelWidth = apart;
      bits.push(`aluminium ${params.slatWidth}mm slats`, `${Math.round(params.height * 1000)}mm high`, wall ? "on a wall" : "");
    } else {
      const h = Number(first(/(\d(?:\.\d+)?)\s*(?:metres?|m)\s+high/i, t)) || Number(form.fenceHeight) || 1.8;
      params.height = h;
      if (style === "colorbond") {
        const sheet = Number(first(/(\d{4})\s*mm\s+(?:high\s+)?colou?rbond\s+sheets?/i, t));
        if (sheet) params.sheetMm = sheet;
        const specials = specialSheets(t).filter((x) => x.mm !== (sheet || 0));
        if (specials.length) params.specialSheets = specials;
        bits.push("Colorbond", `${h}m`, raked ? "raked" : "flat", params.sheetMm ? `${params.sheetMm}mm sheets` : "");
        for (const x of params.specialSheets || []) bits.push(`${x.count} × ${x.mm}mm sheets`);
      } else {
        params.timberStyle = /lapp|capped|good\s+neighbou?r/i.test(t) ? "lapped" : "butted";
        bits.push(params.timberStyle === "lapped" ? "lapped & capped timber" : "butted timber", `${h}m`);
      }
      if (sleeper) bits.push(`${sleeperMm}mm sleepers`);
    }
    if (holeDepth !== 600) bits.push(`${holeDepth}mm holes`);
    sections.push({ label: bits.filter(Boolean).join(" · "), params });
  }

  // gates go with the first section of the same material
  for (const g of items.filter((it) => it.unit !== "m" && /\bgates?\b/i.test(text(it)) && !/rehang|re-hang|hinges? from/i.test(text(it)))) {
    const t = text(g);
    const style = /alumin/i.test(t) ? "aluminium" : /colou?rbond/i.test(t) ? "colorbond" : /timber/i.test(t) ? "timber" : null;
    const host = sections.find((s) => s.params.style === style) || sections[0];
    if (!host) continue;
    host.params.gates = (host.params.gates || 0) + (Number(g.qty) || 1);
    if (/driveway|double|1720|\bwide\b/i.test(t)) host.params.gateWidth = 1.8;
  }
  return sections;
}

// -> { sections: [{ label, items, total }], items (all sections added together), total }
export function calcFromQuote(sections, materials) {
  const done = sections.map((s) => {
    const { specialSheets: specials, ...p } = s.params;
    const items = calcMaterials({ ...p, materials });
    // a bay with taller sheets: that many of the standard sheet come off, and the taller ones go on
    for (const x of specials || []) {
      const std = items.find((i) => /^Colorbond sheet \(/.test(i.desc));
      if (std) std.qty = Math.max(0, std.qty - x.count);
      const h = (x.mm / 1000).toFixed(1);
      items.push({ id: uid(), desc: `Colorbond sheet (${h}H, special bay)`, qty: x.count, rate: matchMaterialRate(materials, ["sheet", `${h}h`]) });
    }
    return { label: s.label, items, total: items.reduce((n, i) => n + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0) };
  });
  const merged = new Map();
  for (const s of done) {
    for (const it of s.items) {
      const cur = merged.get(it.desc);
      if (cur && it.poolPer) {
        // posts cut from the same 5800mm lengths: count the posts across the sections, then the lengths
        cur.poolUnits += it.poolUnits;
        cur.qty = Math.ceil(cur.poolUnits / cur.poolPer);
      } else if (cur) cur.qty += Number(it.qty) || 0;
      else merged.set(it.desc, { ...it, id: uid(), qty: Number(it.qty) || 0 });
    }
  }
  const items = [...merged.values()].map(({ poolUnits, poolPer, ...rest }) => rest);
  return { sections: done, items, total: items.reduce((n, i) => n + i.qty * (Number(i.rate) || 0), 0) };
}
