// Pure business logic ported unchanged from the original artifact.

export const uid = () => Math.random().toString(36).slice(2, 10);

export const money = (n) => (isNaN(n) ? "$0.00" : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export const today = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export function itemsTotal(items) {
  return (items || []).reduce((s, it) => s + Number(it.qty || 0) * Number(it.rate || 0), 0);
}

export function gstBreakdown(subtotal) {
  const gst = subtotal * 0.1;
  return { gst, total: subtotal + gst };
}

// How a line item's quantity should read on the printed document.
export function formatQty(qty, unit) {
  if (unit === "m") return `${qty}m`;
  if (unit === "day") return `${qty} day${Number(qty) === 1 ? "" : "s"}`;
  if (unit === "post" || unit === "job") return `${qty}`;
  return Number(qty) === 1 ? `${qty}` : `${qty}m`;
}

export function addMonths(dateStr, months) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return "";
  d.setMonth(d.getMonth() + months);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDateAU(iso) {
  if (!iso) return "—";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

// A deposit invoice is the one raised from an accepted quote, whose single line item is "Deposit (10%) for ...".
// Worked out from the line item (not stored) so older deposit invoices are recognised too.
export const isDepositInvoice = (inv) => (inv?.items || []).some((it) => /^Deposit \(/i.test(it.desc || ""));

export const DEPOSIT_DUE_NOTE = "Deposit due before works commence";

// Deposit invoices created before this wording change carry "Balance due within 14 days of completion" in
// their notes, which is wrong for a deposit — fixed up when the document is drawn, without touching the saved invoice.
export const fixDepositNote = (note) => String(note || "").replace(/Balance due within 14 days of completion/gi, DEPOSIT_DUE_NOTE);

// Builds a clean, sendable filename like "Quote Paul Palm Beach Colorbond fence"
export function buildFilename(type, data) {
  const docTypeLabel = type === "quote" ? "Quote" : isDepositInvoice(data) ? "Deposit invoice" : "Invoice";
  const jobLabel = data.jobType === "Colorbond" ? "Colorbond fence" : data.jobType || "";
  // "Palm Beach QLD 4221" -> "Palm Beach" for the filename, full text still shows on the doc itself
  const suburbOnly = (data.suburb || "").replace(/\b(QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\b.*$/i, "").trim();
  const parts = [docTypeLabel, data.clientName, suburbOnly, jobLabel].filter(Boolean);
  return parts.join(" ").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim() || "document";
}

export const SLEEPER_NOTE = "Timber sleepers are H3 treated pine.";

// Builds the standard notes bundle for a job, based on job type, length, and what's in the line items.
export function suggestedNotes(jobType, jobLength, items) {
  const lines = [];
  const hasSleeper = (items || []).some((it) => /sleeper/i.test(it.desc || ""));
  lines.push(
    jobLength
      ? `All measurements are an estimate, and the final invoice will be adjusted accordingly by the rate per metre if the length is longer or shorter than ${jobLength}m.`
      : "All measurements are an estimate, and the final invoice will be adjusted accordingly by the rate per metre."
  );
  if (jobType === "Colorbond") {
    lines.push("Colorbond is 100% Australian made and genuine Colorbond.");
    if (hasSleeper) lines.push(SLEEPER_NOTE);
    lines.push("Concrete is rapid-set concrete with a minimum of 2x 20kg bags per hole.");
  }
  if (jobType === "Aluminium fencing") {
    lines.push("Concrete is post mix concrete with a minimum of 2x 20kg bags per hole.");
  }
  if (jobType === "Timber fencing") {
    lines.push("Timber fence palings and rails are H3 treated pine.");
    if (hasSleeper) lines.push(SLEEPER_NOTE);
    lines.push("Timber fence posts are H4 treated hardwood.");
    lines.push("Concrete is rapid-set concrete with a minimum of 2x 20kg bags per hole.");
  }
  return lines;
}

// ---------- material quantity rules of thumb ----------
export function matchMaterialRate(materials, terms) {
  if (!materials || materials.length === 0) return 0;
  const found = materials.find((m) => terms.every((t) => (m.name || "").toLowerCase().includes(t)));
  if (!found) return 0;
  return Number(found.costPerUnit || 0) / (Number(found.packQty) || 1);
}

// Palings per metre of timber fence (lapped & capped is the same as "good neighbour").
export const PALINGS_PER_METRE = { butted: 10, lapped: 13 };

// Screws and nails per 2.4m bay of timber fence.
export const TIMBER_FASTENERS = { butted: { screws: 9, nails: 121 }, lapped: { screws: 12, nails: 160 } };
const TIMBER_BAY_WIDTH = 2.4;

// Screws + nails cost per metre of timber fence, priced from the Materials list.
// Template $/m costs exclude these, so they're added on top.
export function fastenerCostPerMetre(timberStyle, materials) {
  const f = TIMBER_FASTENERS[timberStyle];
  if (!f) return 0;
  return (f.screws * matchMaterialRate(materials, ["batten"]) + f.nails * matchMaterialRate(materials, ["nail"])) / TIMBER_BAY_WIDTH;
}

// Materials cost of the line items that were inserted from a costed job template (item.tpl = template label).
export function templateMaterialsCost(items, templates, materials) {
  return (items || []).reduce((sum, it) => {
    const t = templates.find((j) => j.label === it.tpl);
    if (!t || t.materialCost == null) return sum;
    return sum + (Number(it.qty) || 0) * (t.materialCost + fastenerCostPerMetre(t.timberStyle, materials));
  }, 0);
}

// Colorbond bays: the standard bay is a 2365mm rail with 3 sheets; the long rail is 3125mm with 4 sheets and is meant for the last
// bay of a run. Works out the fewest-waste way to cover a length with standard bays plus (at most) one long bay at the end:
// the shortest total that still covers it, then fewer bays. e.g. 24m = 9 standard + 1 long (24.41m, 31 sheets) rather than
// 11 standard (26.0m, 33 sheets). -> { std, long, covers }
export const CB_STD = { width: 2.365, sheets: 3 };
export const CB_LONG = { width: 3.125, sheets: 4 };
export function colorbondBays(length) {
  const len = Number(length) || 0;
  if (len <= 0) return { std: 0, long: 0, covers: 0 };
  let best = null;
  for (const long of [0, 1]) {
    const rest = len - long * CB_LONG.width;
    const std = Math.max(0, Math.ceil(rest / CB_STD.width - 1e-9));
    if (std + long === 0) continue;
    const covers = std * CB_STD.width + long * CB_LONG.width;
    if (covers < len - 1e-9) continue;
    const cand = { std, long, covers };
    if (!best || covers < best.covers - 1e-9 || (Math.abs(covers - best.covers) < 1e-9 && std + long < best.std + best.long)) best = cand;
  }
  return best;
}

// ---------- aluminium slat fencing (Oxworks DIY concealed-fix system) ----------
// Horizontal 65 x 16mm or 90 x 16mm slats clip between 50 x 50mm channel posts, with 10mm gaps (the gap is your choice).
// From Oxworks' DIY guide: post holes 200mm wide x 600mm deep (a post sits about 500mm in); post centres = slat length + 60-65mm;
// a centre mullion on panels 1800mm and wider; 2 tek screws per slat; slats, posts, mullions and covers come in 5800mm lengths
// that aren't cut in store, so they're costed by the length bought, offcuts and all. Priced from your Materials list by Oxworks item code.
const ALU_STOCK = 5.8; // metres
const ALU_JOINT = 0.0625; // post centres = slat length + this
const ALU_CODES = {
  slat: { 65: "vs5005", 90: "vs5010" },
  gate: { 65: { narrow: "vs5105", wide: "vs5115" }, 90: { narrow: "vs5110", wide: "vs5120" } },
};

export function aluminiumLayout({ length, height, slatWidth, gap, panelWidth }) {
  const len = Number(length) || 0;
  const h = Number(height) || 1.8;
  const sw = Number(slatWidth) === 90 ? 90 : 65;
  const g = Number(gap) > 0 ? Number(gap) : 10;
  const nSlats = Math.max(1, Math.floor((h * 1000 + g) / (sw + g)));
  const finished = nSlats * sw + (nSlats - 1) * g; // mm
  let perLength = 3; // slats from each 5800mm length: 3 leaves almost no offcut
  let slatLen = ALU_STOCK / perLength - 0.005;
  if (Number(panelWidth) > 0) {
    slatLen = Math.max(0.3, Number(panelWidth) - ALU_JOINT);
    perLength = Math.max(1, Math.floor(ALU_STOCK / slatLen + 1e-9));
  }
  const centres = slatLen + ALU_JOINT;
  const panels = len > 0 ? Math.max(1, Math.ceil(len / centres - 1e-9)) : 0;
  return { sw, g, h, nSlats, finished, slatLen, perLength, centres, panels };
}

// onWall: the posts stand on base plates fixed to the top of an existing wall (a 550mm topper on besser block, say) instead of being
// concreted into the ground: posts are cut to the panel height, with a base plate and four anchors each and no concrete.
export function calcAluminium({ length, height, slatWidth, gap, panelWidth, gates, gateWidth, onWall, materials }) {
  const L = aluminiumLayout({ length, height, slatWidth, gap, panelWidth });
  if (L.panels <= 0) return [];
  const rate = (terms) => matchMaterialRate(materials, terms);
  const gateCount = Number(gates) || 0;
  const items = [];

  const postCut = onWall ? L.h + 0.05 : L.h + 0.5; // 500mm in the ground, or standing on a base plate
  const postsPerLength = Math.max(1, Math.floor(ALU_STOCK / postCut + 1e-9));
  const stdPerLength = Math.max(1, Math.floor(ALU_STOCK / L.h + 1e-9)); // mullions and covers are cut to the fence height
  const mullions = L.slatLen >= 1.8 - 1e-9 ? L.panels : 0;
  const endPosts = 2 + gateCount * 2; // 1-way: both ends of the run and both sides of each gate
  const midPosts = Math.max(0, L.panels - 1); // 2-way: between two panels
  const posts = endPosts + midPosts;
  const covers = endPosts + midPosts * 2 + mullions; // one snap-on cover for each channel

  items.push({ desc: `${L.sw} x 16mm slat 5800mm (${L.nSlats} per panel, ${L.g}mm gaps, ${L.panels} panel${L.panels === 1 ? "" : "s"})`, qty: Math.ceil((L.panels * L.nSlats) / L.perLength), rate: rate([ALU_CODES.slat[L.sw]]) });
  items.push({ desc: "Conceal fix 1-way post 5800mm (ends, cut to height)", qty: Math.ceil(endPosts / postsPerLength), rate: rate(["vs5035"]) });
  if (midPosts > 0) items.push({ desc: "Conceal fix 2-way post 5800mm (mid-run, cut to height)", qty: Math.ceil(midPosts / postsPerLength), rate: rate(["vs5040"]) });
  if (mullions > 0) items.push({ desc: "Centre mullion 5800mm (panels 1.8m and wider)", qty: Math.ceil(mullions / stdPerLength), rate: rate(["vs5020"]) });
  items.push({ desc: "Snap-on fixing cover 5800mm", qty: Math.ceil(covers / stdPerLength), rate: rate(["vs5025"]) });
  items.push({ desc: "Post cap 50 x 50mm (aluminium)", qty: posts, rate: rate(["vs5090"]) });
  if (mullions > 0) items.push({ desc: "Centre mullion cap (plastic)", qty: mullions, rate: rate(["vs5070"]) });
  items.push({ desc: "10mm slat spacers, 50 pack", qty: Math.ceil((L.panels * 2 * (L.nSlats - 1)) / 50), rate: rate(["vs5050"]) });
  items.push({ desc: "Tek screws 10-16x16 (2 per slat, plus mullions)", qty: Math.ceil((L.panels * L.nSlats * 2 + mullions * L.nSlats) * 1.05), rate: rate(["hw5000"]) });
  // Oxworks specify post mix concrete in the hole (200 x 600mm, about two 20kg bags).
  if (onWall) {
    items.push({ desc: "Base plate 100 x 100mm", qty: posts, rate: rate(["vs5045"]) });
    items.push({ desc: "M8 x 70 concrete anchor (4 per plate)", qty: posts * 4, rate: rate(["fr3395"]) });
  } else {
    items.push({ desc: "Concrete post mix 20kg bag", qty: posts * 2, rate: rate(["hw5505"]) || rate(["post mix"]) || rate(["concrete"]) });
  }

  if (gateCount > 0) {
    const wide = (Number(gateWidth) || 1) > 1.05;
    items.push({ desc: `${L.sw}mm slat gate ${wide ? "1720" : "930"} x 1800mm (pre-fabricated)`, qty: gateCount, rate: rate([ALU_CODES.gate[L.sw][wide ? "wide" : "narrow"]]) });
    items.push({ desc: "Gate hinge and latch pack (D&D LokkLatch, TruClose hinges)", qty: gateCount, rate: rate(["hw9904"]) });
  }
  return items.map((it) => ({ ...it, id: uid() }));
}

// Picks the smallest stocked size that's long enough and actually priced in the Materials list, e.g. a 2.0m fence needs 2.6m of post, which
// the list stocks as 2.7m. Falls back to the size that's needed when nothing in the list matches (it then shows $0.00 so you can see it).
const SIZES = [1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0, 3.3, 3.6];
const sz = (n) => n.toFixed(1);
function pickSize(needed, termsFor, rateOf) {
  for (const s of SIZES) {
    if (s < needed - 1e-9) continue;
    if (rateOf(termsFor(sz(s))) > 0) return s;
  }
  return Math.round(needed * 10) / 10;
}

// A "w/ sleeper 2m" fence is a 1.8m fence standing on a 200x50 treated pine sleeper: 2m overall, but the palings or sheets are the
// 1.8m ones, the posts are cut for the full 2m, and there's one sleeper per bay (2.4m; 3.0m for a Colorbond long bay).
export function calcMaterials({ style, timberStyle, length, height, gates, gateWidth, postSpacing, panelWidth, raked, sleeper, slatWidth, gap, onWall, holeDepth, materials }) {
  if (style === "aluminium") return calcAluminium({ length, height, slatWidth, gap, panelWidth, gates, gateWidth, onWall, materials });
  const len = Number(length) || 0;
  const gateCount = Number(gates) || 0;
  const gateWidthM = Number(gateWidth) || 1; // pedestrian gate ~1m; a double/driveway gate ~2m
  const h = Number(height) || 1.8;
  const defaultSpacing = style === "colorbond" ? 2.365 : 2.4;
  const spacing = Number(postSpacing) || defaultSpacing;
  const width = Number(panelWidth) || spacing;
  if (len <= 0) return [];

  const bays = Math.max(1, Math.ceil(len / width));
  const rate = (terms) => matchMaterialRate(materials, terms);
  const hasSleeper = !!sleeper;
  const fenceH = hasSleeper ? (h < 1.95 ? h : Math.round((h - 0.2) * 10) / 10) : h; // the palings / sheets
  const totalH = hasSleeper ? Math.round((fenceH + 0.2) * 10) / 10 : h; // what the finished fence stands
  // Holes are 600mm deep unless the quote says otherwise ("900mm deep concrete footings due to the sand"): the posts go as deep as the
  // hole, and a deeper hole takes more concrete (2 bags at 600mm, 3 at 900mm, 4 at 1200mm).
  const depthMm = Number(holeDepth) >= 600 ? Number(holeDepth) : 600;
  const bagsPerHole = Math.max(2, Math.round(depthMm / 300));
  const postNeeded = totalH + depthMm / 1000;
  const items = [];
  let gatePalingsPerMetre = 0; // timber gates are clad in palings, at the same density as the fence
  let palingLen = fenceH;
  const sleeperLine = (n, length) => ({ desc: `Sleeper 200x50 (${sz(length)}m)`, qty: n, rate: rate(["sleeper", `${sz(length)}m`]) });

  if (style === "timber") {
    const lapped = timberStyle === "lapped";
    const railGroups = Math.ceil(bays / 2); // one 4.8m rail spans 2 bays
    // Palings go by the metre, not by the bay: 10 a metre butted, 13 a metre lapped & capped (good neighbour).
    const palingsPerMetre = lapped ? PALINGS_PER_METRE.lapped : PALINGS_PER_METRE.butted;
    gatePalingsPerMetre = palingsPerMetre;
    const railsPerGroup = lapped ? 4 : 3; // lapped & capped adds a capping rail
    const { screws: screwsPerBay, nails: nailsPerBay } = TIMBER_FASTENERS[lapped ? "lapped" : "butted"];
    palingLen = pickSize(fenceH, (s) => ["paling", `${s}m`], rate);
    const postLen = pickSize(postNeeded, (s) => ["post", "hardwood", `${s}m`], (t) => rate(t) || rate(["post", t[t.length - 1]]));

    items.push({ desc: `Paling (${sz(palingLen)}m)`, qty: Math.ceil(len * palingsPerMetre), rate: rate(["paling", `${sz(palingLen)}m`]) });
    items.push({ desc: `Post (${sz(postLen)}m)`, qty: bays, rate: rate(["post", "hardwood", `${sz(postLen)}m`]) || rate(["post", `${sz(postLen)}m`]) });
    items.push({ desc: "Rail 4.8m (spans 2 bays)", qty: railGroups * railsPerGroup, rate: rate(["rail", "pine"]) });
    if (hasSleeper) items.push(sleeperLine(bays, 2.4));
    items.push({ desc: "Concrete 20kg bag", qty: bays * bagsPerHole, rate: rate(["concrete"]) });
    items.push({ desc: "Batten screws", qty: bays * screwsPerBay, rate: rate(["batten"]) });
    items.push({ desc: "Nails", qty: bays * nailsPerBay, rate: rate(["nail"]) });
  } else {
    // Per your recipe: each bay = its sheets (3 on a 2365mm rail, 4 on the 3125mm one), 2 rails, 2 posts, 2 bags concrete.
    // Unless a bay width / post spacing has been typed in, the run is split into standard bays plus a long bay at the end where that fits.
    const mix = Number(panelWidth) || Number(postSpacing) ? { std: bays, long: 0 } : colorbondBays(len);
    // Cut on a rake, a 1.8m fence uses 2100mm sheets (cut down to follow the slope), so the sheet to buy is the 2.1H one.
    // (With a sleeper the fence is 1.8m of sheet, as the quote template says.)
    const sheetNeeded = raked && !hasSleeper && h <= 1.8 ? 2.1 : fenceH;
    const sheetH = pickSize(sheetNeeded, (s) => ["sheet", `${s}h`], rate);
    const postH = pickSize(postNeeded, (s) => ["c post", `${s}h`], rate);
    const totalBays = mix.std + mix.long;
    items.push({ desc: `Colorbond sheet (${sz(sheetH)}H${raked ? ", cut on a rake" : ""})`, qty: mix.std * CB_STD.sheets + mix.long * CB_LONG.sheets, rate: rate(["sheet", `${sz(sheetH)}h`]) });
    const custom = Number(panelWidth) || Number(postSpacing); // a typed-in bay width keeps the old single-size behaviour
    const stdRailW = Math.round((custom ? width : CB_STD.width) * 1000);
    if (mix.std > 0) items.push({ desc: `Rail (${stdRailW}W)`, qty: mix.std * 2, rate: rate(["rail", `${stdRailW}w`]) });
    if (mix.long > 0) items.push({ desc: `Rail (${Math.round(CB_LONG.width * 1000)}W, long bay)`, qty: mix.long * 2, rate: rate(["rail", `${Math.round(CB_LONG.width * 1000)}w`]) });
    items.push({ desc: `Colorbond C post (${sz(postH)}H)`, qty: totalBays * 2, rate: rate(["c post", `${sz(postH)}h`]) });
    if (hasSleeper) {
      if (mix.std > 0) items.push(sleeperLine(mix.std, custom && width > 2.4 ? 3.0 : 2.4));
      if (mix.long > 0) items.push(sleeperLine(mix.long, 3.0));
    }
    items.push({ desc: "Concrete 20kg bag", qty: Math.ceil(totalBays * bagsPerHole), rate: rate(["concrete"]) });
  }
  if (gateCount > 0) {
    items.push({ desc: "Gate frame, supply + install", qty: gateCount, rate: rate(["gate"]) });
    if (gatePalingsPerMetre > 0) {
      items.push({ desc: `Gate palings (${sz(palingLen)}m)`, qty: Math.ceil(gateCount * gateWidthM * gatePalingsPerMetre), rate: rate(["paling", `${sz(palingLen)}m`]) });
    }
  }

  return items.map((it) => ({ ...it, id: uid() }));
}

export function estFuelCost(distanceKm, settings) {
  const km = Number(distanceKm) || 0;
  const consumption = Number(settings?.consumption) || 10.5;
  const price = Number(settings?.fuelPrice) || 1.85;
  return km * (consumption / 100) * price;
}
