// ---------- constants ----------
export const JOB_TYPES = ["Timber fencing", "Colorbond", "Gates", "Retaining wall", "Repairs", "Other"];
export const LEAD_STATUSES = ["New", "Contacted", "Quoted", "Won", "Lost"];
export const QUOTE_STATUSES = ["Draft", "Sent", "Accepted", "Declined"];
export const INVOICE_STATUSES = ["Unpaid", "Paid", "Overdue"];
export const EXPENSE_CATEGORIES = ["Materials", "Fuel", "Tipping/waste", "Tools/Equipment", "Subcontractor", "Insurance", "Other"];

// ---------- branding & business details ----------
export const BIZ = {
  name: "Lyons Fencing & Services",
  abn: "81431302746",
  email: "Lyonsfencingservices@gmail.com",
  phone: "0424126358",
  website: "lyonsfencingservices.com.au",
  bankAccountName: "Artie Lyons",
  bsb: "033091",
  accountNumber: "624548",
};

// Pulled from your real quotes — same wording every time so it reads consistent to clients
export const STANDARD_TERMS = [
  "Utilities: Water and electricity to be provided by client.",
  "Site preparation: All attachments and obstructions must be removed from existing fence before works commence.",
  "Excavated soil: All soil excavated from post holes will be dispersed around the property.",
  "Change of mind: A 10% restock fee applies for change of mind regarding colour, height, or profile after materials have been ordered.",
  "Delays: Lyons Fencing & Services is not responsible for delays caused by weather, supplier issues, or unforeseen circumstances.",
  "Insurance: Lyons Fencing & Services is fully insured with $5 million public liability cover.",
  "Warranty: All workmanship guaranteed for 24 months from completion date.",
  "Deposit: 10% deposit is fully refundable.",
];

export const UNDERGROUND_DISCLAIMER = "A Before You Dig Australia search will be conducted prior to works. Lyons Fencing & Services is not liable for unmarked or inaccurately located underground services. Any required repairs will incur additional charges.";

// Common note snippets, one tap to insert
export const NOTE_SNIPPETS = [
  "All timber fence palings and rails are H3 treated pine.",
  "Timber fence posts are H4 treated hardwood.",
  "Concrete is rapid-set concrete with a minimum of 2x 20kg bags per hole.",
  "All measurements are an estimate, and the final invoice will be adjusted accordingly by the rate per metre.",
];

// Job line templates, wording and rates drawn from your actual past quotes — a starting point, not gospel.
// {height} gets swapped for the Fence height field when inserted.
export const JOB_TEMPLATES = [
  { label: "Timber fence removal", desc: "Removal and disposal of existing timber fence.", unit: "m", rate: 25 },
  { label: "Timber + chain wire fence removal", desc: "Removal and disposal of existing timber and chain wire fence.", unit: "m", rate: 20 },
  { label: "Butted paling timber fence installation", desc: "Supply and installation of butted paling timber fence at {height} metres high with 600mm deep concrete footings. Hardwood fence posts spaced approximately 2.4 metres apart with treated pine fence rails and 75mm batten screws screwed into the post. All the treated pine fence palings are nailed into the rails using a coil nail gun.", unit: "m", rate: 150 },
  { label: "Lapped & capped timber fence installation", desc: "Supply and installation of lapped and capped paling timber fence at {height} metres high with 600mm deep concrete footings. Hardwood fence posts spaced approximately 2.4 metres apart with 75mm batten screws screwing the fence rails into the fence posts. Fence rails to be used as capping. Fence palings nailed into the fence rails using a coil nail gun.", unit: "m", rate: 170 },
  { label: "Colorbond fence installation", desc: "Supply and installation of Colorbond fence at {height} metres high with 600mm deep concrete footings. Some of the posts will require a square to be cut out of the concrete slab/patio to allow us to concrete the Colorbond posts into the ground.", unit: "m", rate: 160, rateFn: (h) => 160 + Math.round(((Number(h) || 1.8) - 1.8) / 0.3) * 10 },
  { label: "Timber fence post replacement", desc: "Supply and installation of hardwood fence post(s) at 2.4 metres high with 600mm deep concrete footings. Once the concrete has set, 75mm galvanised batten screws will be screwed into the new fence post(s) to bring the fence back level.", unit: "post", rate: 280 },
  { label: "Colorbond gate post installation", desc: "Supply and installation of Colorbond C post for gate, with 600mm deep concrete footings.", unit: "job", rate: 120 },
  { label: "Vegetation pruning/removal", desc: "Removal and disposal of vegetation in the way of the boundary line.", unit: "job", rate: 300 },
  { label: "Mini excavator/truck hire", desc: "Mini excavator required to dig the holes and truck to tow/remove the existing fence.", unit: "day", rate: 500 },
  { label: "Material delivery", desc: "Delivery of timber and concrete to site.", unit: "job", rate: 300 },
];

// Pulled from Bunnings cart screenshots + Our Town Fencing invoices (incl. GST, per unit)
export const PRESET_MATERIALS = [
  "100x16mm Treated Pine Paling 1.2m, 1.76, each",
  "100x16mm Treated Pine Paling 1.5m, 2.19, each",
  "100x16mm Treated Pine Paling 1.8m, 2.33, each",
  "100x16mm Treated Pine Paling 2.1m, 3.06, each",
  "100x75mm Hardwood Fence Post 2.4m, 30.58, each",
  "100x75mm Hardwood Fence Post 2.7m, 35.59, each",
  "75x38mm Treated Pine Fence Rail 4.8m, 12.27, each",
  "Bastion 20kg Rapid Set Concrete, 9.52, bag",
  "200x50mm Treated Pine Sleeper 1.8m, 18.15, each",
  "200x50mm Treated Pine Sleeper 2.4m, 24.04, each",
  "200x50mm Treated Pine Sleeper 3.0m, 30.07, each",
  "RapidFence Steel Gate Frame Kit 1200x1870mm, 103.55, each",
  "Colorbond Gate Post 2.1H (65x65), 61.06, each",
  "Colorbond Gate Post 2.4H (65x65), 69.86, each",
  "Colorbond C Post 2.1H, 9.67, each",
  "Colorbond C Post 2.4H, 10.95, each",
  "Colorbond C Post 2.7H, 13.03, each",
  "Colorbond Sheet 1.8H, 20.82, each",
  "Colorbond Sheet 2.1H, 26.28, each",
  "Colorbond Rail 2365W, 10.83, each",
  "Colorbond Rail 3125W, 14.40, each",
  "Colorbond Gate Style 50x50 Pr 1800H, 83.05, each",
  "Gate Hinge Pair 100x75, 14.39, pair",
  "Gate D-Latch & Striker, 14.39, each",
  "D-Latch Striker Cover, 1.89, each",
  "Gate Extender Handle 170mm, 2.55, each",
  "Tek Screws 16mm C4 (box), 0, box, 1",
  "Bugle Batten Screws 14G x 75mm (500 pack), 59.52, box, 500",
  "Ring Shank Coil Nails 50x2.5mm (9000 pack), 122.55, box, 9000",
].join("\n");

export const statusColor = {
  New: "#7C8B85", Contacted: "#E8B923", Quoted: "#A9743C", Won: "#5A8F6E", Lost: "#C1553A",
  Draft: "#7C8B85", Sent: "#E8B923", Accepted: "#5A8F6E", Declined: "#C1553A",
  Unpaid: "#E8B923", Paid: "#5A8F6E", Overdue: "#C1553A",
};
