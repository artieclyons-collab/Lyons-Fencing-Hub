// ---------- constants ----------
export const JOB_TYPES = ["Timber fencing", "Colorbond", "Aluminium fencing", "Gates", "Retaining wall", "Repairs", "Other"];
export const LEAD_STATUSES = ["New", "Contacted", "Quoted", "Won", "Lost"];
export const QUOTE_STATUSES = ["Draft", "Sent", "Accepted", "Declined"];
export const INVOICE_STATUSES = ["Unpaid", "Paid", "Overdue"];
export const EXPENSE_CATEGORIES = ["Materials", "Fuel", "Tipping/waste", "Tools/Equipment", "Subcontractor", "Insurance", "Other"];

// Hourly pay options for employees on a job (used in the quote's "Your costs" labour estimate).
export const LABOUR_RATES = [
  { id: "labourer", label: "Labourer (cash)", rate: 35 },
  { id: "cash", label: "Cash", rate: 40 },
  { id: "abn", label: "ABN", rate: 50 },
];

// ---------- branding & business details ----------
export const BIZ = {
  name: "Lyons Fencing & Services",
  abn: "81431302746",
  email: "Lyonsfencingservices@gmail.com",
  phone: "0424126358",
  website: "lyonsfencingservices.com.au",
  // The link clients tap to leave a Google review (Google Business Profile → "Ask for reviews" → copy link). Leave empty and review requests just leave the link out.
  reviewUrl: "https://www.google.com/maps?cid=7333166478457889473", // your Google Maps listing (shows the reviews and a Write a review button)
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
// Each fence height/style has its own template (height is baked into the label, wording and rate).
// A {height} placeholder in desc, or a rateFn, still works if a template ever wants to follow the Fence height field.
// materialCost = your materials cost per metre inc GST, excluding screws and nails. timberStyle ("butted" | "lapped")
// tells the quote form to add screws + nails per metre on top, priced from the Materials list.
export const JOB_TEMPLATES = [
  { label: "Timber fence removal", desc: "Removal and disposal of existing timber fence.", unit: "m", rate: 25 },
  { label: "Timber + chain wire fence removal", desc: "Removal and disposal of existing timber and chain wire fence.", unit: "m", rate: 20 },
  { label: "Butted paling timber fence installation 1.8m", desc: "Supply and installation of butted paling timber fence at 1.8 metres high with 600mm deep concrete footings. Hardwood fence posts spaced approximately 2.4 metres apart with treated pine fence rails and 75mm batten screws screwed into the post. All the treated pine fence palings are nailed into the rails using a coil nail gun.", unit: "m", rate: 150, materialCost: 72, timberStyle: "butted" },
  { label: "Butted paling timber fence installation 2.1m", desc: "Supply and installation of butted paling timber fence at 2.1 metres high with 600mm deep concrete footings. Hardwood fence posts spaced approximately 2.4 metres apart with treated pine fence rails and 75mm batten screws screwed into the post. All the treated pine fence palings are nailed into the rails using a coil nail gun.", unit: "m", rate: 180, materialCost: 83.5, timberStyle: "butted" },
  { label: "Butted paling timber fence installation w/ sleeper 2m", desc: "Supply and installation of butted paling timber fence at 2 metres high with 600mm deep concrete footings. 200mm treated pine timber sleepers screwed into the fence posts with 1.8 metre fence palings on top bringing the total height to 2 metres high. Hardwood fence posts spaced approximately 2.4 metres apart with treated pine fence rails and 75mm batten screws screwed into the post. All the treated pine fence palings are nailed into the rails using a coil nail gun.", unit: "m", rate: 190, materialCost: 86, timberStyle: "butted" },
  { label: "Lapped & capped timber fence installation 1.8m", desc: "Supply and installation of lapped and capped paling timber fence at 1.8 metres high with 600mm deep concrete footings. Hardwood fence posts spaced approximately 2.4 metres apart with 75mm batten screws screwing the fence rails into the fence posts. Fence rails to be used as capping. Fence palings nailed into the fence rails using a coil nail gun.", unit: "m", rate: 195, materialCost: 85, timberStyle: "lapped" },
  { label: "Lapped & capped timber fence installation 2.1m", desc: "Supply and installation of lapped and capped paling timber fence at 2.1 metres high with 600mm deep concrete footings. Hardwood fence posts spaced approximately 2.4 metres apart with 75mm batten screws screwing the fence rails into the fence posts. Fence rails to be used as capping. Fence palings nailed into the fence rails using a coil nail gun.", unit: "m", rate: 235, materialCost: 99, timberStyle: "lapped" },
  { label: "Lapped & capped timber fence installation w/ sleeper 2m", desc: "Supply and installation of lapped and capped paling timber fence at 2 metres high with 600mm deep concrete footings. 200mm treated pine timber sleepers screwed into the fence posts with 1.8 metre fence palings on top bringing the total height to 2 metres high. Hardwood fence posts spaced approximately 2.4 metres apart with 75mm batten screws screwing the fence rails into the fence posts. Fence rails to be used as capping. Fence palings nailed into the fence rails using a coil nail gun.", unit: "m", rate: 235, materialCost: 99, timberStyle: "lapped" },
  { label: "Colorbond fence installation 1.8m", desc: "Supply and installation of Colorbond fence at 1.8 metres high with 1800mm Colorbond sheets and 600mm deep concrete footings.", unit: "m", rate: 135, materialCost: 61 },
  { label: "Colorbond fence installation 2.1m", desc: "Supply and installation of Colorbond fence at 2.1 metres high with 2100mm Colorbond sheets and 600mm deep concrete footings.", unit: "m", rate: 160, materialCost: 71.5 },
  { label: "Colorbond fence installation w/ sleeper 2m", desc: "Supply and installation of Colorbond fence at 2 metres high with 1800mm Colorbond sheets and 600mm deep concrete footings. Installation of 200mm treated pine timber sleepers underneath the Colorbond fence bringing the total height to 2 metres high.", unit: "m", rate: 165, materialCost: 75 },
  { label: "Raked Colorbond fence installation 1.8m", desc: "Supply and installation of Colorbond fence at 1.8 metres high with 2100mm Colorbond sheets cut on a rake to suit the gradient of the land and 600mm deep concrete footings.", unit: "m", rate: 170, materialCost: 68 },
  { label: "Raked Colorbond fence installation w/ sleeper 2m", desc: "Supply and installation of Colorbond fence at 2 metres high with 1800mm Colorbond sheets cut on a rake to suit the gradient of the land and 600mm deep concrete footings. Installation of 200mm treated pine timber sleepers underneath the Colorbond fence bringing the total height to 2 metres high.", unit: "m", rate: 200, materialCost: 78 },
  { label: "Aluminium slat fence installation 1.8m (65mm slats)", desc: "Supply and installation of 65mm aluminium slat fence at 1.8 metres high with 10mm gaps between the slats. Powder coated aluminium slats are fixed into 50x50mm aluminium posts with a concealed fixing system, set in 600mm deep concrete footings. Posts spaced approximately 2 metres apart.", unit: "m", rate: 850, materialCost: 390 },
  { label: "Aluminium slat fence installation 1.8m (90mm slats)", desc: "Supply and installation of 90mm aluminium slat fence at 1.8 metres high with 10mm gaps between the slats. Powder coated aluminium slats are fixed into 50x50mm aluminium posts with a concealed fixing system, set in 600mm deep concrete footings. Posts spaced approximately 2 metres apart.", unit: "m", rate: 800, materialCost: 365 },
  { label: "Aluminium slat panels 550mm high on a wall (90mm slats)", desc: "Supply and installation of 90mm aluminium slat panels at 550mm high with a concealed fixing system. Powder coated aluminium slats are fixed between 50x50mm aluminium posts, with the posts fixed to the top of the existing wall using base plates and anchors. Panels spaced approximately 2.3 metres apart.", unit: "m", rate: 325, materialCost: 149 },
  { label: "Aluminium slat pedestrian gate 930 x 1800mm (65mm slats)", desc: "Supply and installation of an aluminium slat pedestrian gate (930mm wide x 1.8 metres high) with 65mm slats, a powder coated aluminium frame and aluminium posts set in concrete. Supply and installation of a D&D LokkLatch lockable latch and TruClose self-closing hinges.", unit: "job", rate: 2000 },
  { label: "Aluminium slat pedestrian gate 930 x 1800mm (90mm slats)", desc: "Supply and installation of an aluminium slat pedestrian gate (930mm wide x 1.8 metres high) with 90mm slats, a powder coated aluminium frame and aluminium posts set in concrete. Supply and installation of a D&D LokkLatch lockable latch and TruClose self-closing hinges.", unit: "job", rate: 2100 },
  { label: "Aluminium slat driveway gate 1720 x 1800mm (65mm slats)", desc: "Supply and installation of an aluminium slat driveway gate (1720mm wide x 1.8 metres high) with 65mm slats, a powder coated aluminium frame and aluminium posts set in concrete. Supply and installation of a D&D LokkLatch lockable latch and TruClose self-closing hinges.", unit: "job", rate: 2500 },
  { label: "Aluminium slat driveway gate 1720 x 1800mm (90mm slats)", desc: "Supply and installation of an aluminium slat driveway gate (1720mm wide x 1.8 metres high) with 90mm slats, a powder coated aluminium frame and aluminium posts set in concrete. Supply and installation of a D&D LokkLatch lockable latch and TruClose self-closing hinges.", unit: "job", rate: 2500 },
  { label: "Colorbond pedestrian gate w/ post attached to house", desc: "Supply and installation of Colorbond pedestrian gate at 1.8 metres high with one of the posts attached to the house. Supply and installation of D-latch with a striker to allow the gate to be locked and opened from either side.", unit: "job", rate: 950 },
  { label: "Timber pedestrian gate w/ post attached to house", desc: "Supply and installation of timber pedestrian gate at 1.8 metres high with one of the posts attached to the house. Supply and installation of D-latch with a hole drilled into timber to allow the gate to be locked and opened from either side.", unit: "job", rate: 950 },
  { label: "Timber fence post replacement", desc: "Supply and installation of hardwood fence post(s) at 2.4 metres high with 600mm deep concrete footings. Once the concrete has set, 75mm galvanised batten screws will be screwed into the new fence post(s) to bring the fence back level.", unit: "post", rate: 280 },
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
  // Oxworks (aluminium slat fencing), Inc GST — stock colour, the "from" price
  "65 x 16mm Ribbed Slat 5800mm (VS5005), 59.40, each",
  "90 x 16mm Ribbed Slat 5800mm (VS5010), 72.60, each",
  "50 x 50mm Conceal Fix 1-Way Post 5800mm (VS5035), 168.30, each",
  "50 x 50mm Conceal Fix 2-Way Post 5800mm (VS5040), 192.50, each",
  "50 x 50mm Conceal Fix Plain Post 5800mm (VS5030), 119.90, each",
  "25 x 25mm Conceal Fix U-Channel 5800mm (VS5015), 48.40, each",
  "Snap-On Fixing Cover 5800mm (VS5025), 37.40, each",
  "25 x 11mm Conceal Fix Centre Mullion 5800mm (VS5020), 42.90, each",
  "50 x 50mm Post Cap Aluminium (VS5090), 9.68, each",
  "Post Cap Plastic Suits Concealed System (VS5075), 2.53, each",
  "U-Channel Cap Aluminium (VS5080), 4.51, each",
  "Centre Mullion Plastic Cap (VS5070), 1.98, each",
  "10mm Slat Spacer 50 Pack (VS5050), 20.90, each",
  "Tek Screw 10-16x16 single (HW5000), 0.10, each",
  "100 x 100mm Base Plate (VS5045), 12.65, each",
  "65mm Slat Gate 930 x 1800mm (VS5105), 423.50, each",
  "65mm Slat Gate 1720 x 1800mm (VS5115), 770.00, each",
  "90mm Slat Gate 930 x 1800mm (VS5110), 491.70, each",
  "90mm Slat Gate 1720 x 1800mm (VS5120), 770.00, each",
  "D&D LokkLatch Deluxe & TruClose Hinge Pack (HW9904), 193.60, each",
  "Concrete Post Mix 20kg (HW5505), 15.40, each",
  "M8 x 70 Concrete Fixing (FR3395), 8.80, each",
].join("\n");

export const statusColor = {
  New: "#7C8B85", Contacted: "#E8B923", Quoted: "#A9743C", Won: "#5A8F6E", Lost: "#C1553A",
  Draft: "#7C8B85", Sent: "#E8B923", Accepted: "#5A8F6E", Declined: "#C1553A",
  Unpaid: "#E8B923", Paid: "#5A8F6E", Overdue: "#C1553A",
};
