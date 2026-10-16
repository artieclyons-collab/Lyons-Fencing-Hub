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

export function calcMaterials({ style, timberStyle, length, height, gates, gateWidth, postSpacing, panelWidth, materials }) {
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
  const postLength = Math.round((h + 0.6) * 10) / 10; // posts are always 600mm in the ground
  const items = [];
  let gatePalingsPerMetre = 0; // timber gates are clad in palings, at the same density as the fence

  if (style === "timber") {
    const lapped = timberStyle === "lapped";
    const railGroups = Math.ceil(bays / 2); // one 4.8m rail spans 2 bays
    const palingsPerBay = lapped ? 32 : 24;
    gatePalingsPerMetre = palingsPerBay / TIMBER_BAY_WIDTH;
    const railsPerGroup = lapped ? 4 : 3; // lapped & capped adds a capping rail
    const { screws: screwsPerBay, nails: nailsPerBay } = TIMBER_FASTENERS[lapped ? "lapped" : "butted"];

    items.push({ desc: `Paling (${h}m)`, qty: bays * palingsPerBay, rate: rate(["paling", `${h}m`]) });
    items.push({ desc: `Post (${postLength}m)`, qty: bays, rate: rate(["post", "hardwood", `${postLength}m`]) || rate(["post", `${postLength}m`]) });
    items.push({ desc: "Rail 4.8m (spans 2 bays)", qty: railGroups * railsPerGroup, rate: rate(["rail", "pine"]) });
    items.push({ desc: "Concrete 20kg bag", qty: bays * 2, rate: rate(["concrete"]) });
    items.push({ desc: "Batten screws", qty: bays * screwsPerBay, rate: rate(["batten"]) });
    items.push({ desc: "Nails", qty: bays * nailsPerBay, rate: rate(["nail"]) });
  } else {
    // Per your recipe: each 2365mm bay = 3 sheets, 2 rails, 2 posts, 2 bags concrete
    items.push({ desc: `Colorbond sheet (${h}H)`, qty: bays * 3, rate: rate(["sheet", `${h}h`]) });
    items.push({ desc: `Rail (${Math.round(width * 1000)}W)`, qty: bays * 2, rate: rate(["rail", `${Math.round(width * 1000)}w`]) });
    items.push({ desc: `Colorbond C post (${postLength}H)`, qty: bays * 2, rate: rate(["c post", `${postLength}h`]) });
    items.push({ desc: "Concrete 20kg bag", qty: bays * 2, rate: rate(["concrete"]) });
  }
  if (gateCount > 0) {
    items.push({ desc: "Gate frame, supply + install", qty: gateCount, rate: rate(["gate"]) });
    if (gatePalingsPerMetre > 0) {
      items.push({ desc: `Gate palings (${h}m)`, qty: Math.ceil(gateCount * gateWidthM * gatePalingsPerMetre), rate: rate(["paling", `${h}m`]) });
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
