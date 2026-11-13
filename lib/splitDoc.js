// Splitting a quote or an invoice in half when two neighbours share a fence and each pays their side.
// Pure helpers (no imports) so the same rules work in the screen and in scripts.
//  - lines priced per metre: the length is halved (34.5m becomes 17.25m each) and the rate stays the same
//  - other lines (delivery, a gate, a flat fee): the same quantity at half the price
//  - credits (a negative amount, e.g. "Less: deposit already received") stay with the original client; the neighbour doesn't get them
// The two halves always add back up to the original, to the cent.

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const isCredit = (it) => Number(it.rate) < 0 || /^\s*less\b/i.test(it.desc || "");
const isPerMetre = (it) => String(it.unit || "").toLowerCase() === "m";

// -> { mine, theirs } (lists of line items; ids are assigned by `newId` for the neighbour's copies)
export function halveItems(items, newId = () => Math.random().toString(36).slice(2, 10)) {
  const mine = [];
  const theirs = [];
  for (const it of items || []) {
    if (isCredit(it)) { mine.push({ ...it }); continue; }
    if (isPerMetre(it)) {
      const q = Number(it.qty) || 0;
      const half = r2(q / 2);
      mine.push({ ...it, qty: half });
      theirs.push({ ...it, id: newId(), qty: r2(q - half) });
    } else {
      const rate = Number(it.rate) || 0;
      const half = r2(rate / 2);
      mine.push({ ...it, rate: half });
      theirs.push({ ...it, id: newId(), rate: r2(rate - half) });
    }
  }
  return { mine, theirs };
}

export const SPLIT_NOTE = "This is half of a shared fence; the other half is invoiced to the neighbour separately.";
const withNote = (notes, note) => {
  const n = String(notes || "");
  return n.includes(note) ? n : [n.trim(), note].filter(Boolean).join("\n");
};

const half = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? v : String(r2(Number(v) / 2)));

// The neighbour's details: { clientName, clientPhone, clientEmail, address, suburb }
const neighbourFields = (n) => ({
  clientName: n.clientName,
  clientPhone: n.clientPhone || "",
  clientEmail: n.clientEmail || "",
  address: n.address || "",
  suburb: n.suburb || "",
  billName: "", // the neighbour's own name, not whoever the original was made out to
});

// -> { mine, theirs }: the original invoice halved, and a new unpaid invoice for the neighbour (same job, so both count towards it)
export function splitInvoice(inv, neighbour, { id, docNumber, today, newId }) {
  const { mine, theirs } = halveItems(inv.items, newId);
  return {
    mine: { ...inv, items: mine, notes: withNote(inv.notes, SPLIT_NOTE) },
    theirs: {
      ...inv,
      ...neighbourFields(neighbour),
      id,
      inserted_at: undefined,
      docNumber,
      items: theirs,
      status: "Unpaid",
      issuedDate: today,
      dueDate: "",
      paidDate: null,
      lastChase: null,
      lastEmailed: null,
      notes: withNote(inv.notes, SPLIT_NOTE),
    },
  };
}

// -> { mine, theirs }: the quote halved (lines, lengths, materials), and a new draft quote for the neighbour
export function splitQuote(q, neighbour, { id, docNumber, today, newId }) {
  const { mine, theirs } = halveItems(q.items, newId);
  const halfFields = (src) => ({
    jobLength: half(src.jobLength),
    removalLength: half(src.removalLength),
    materialsCost: half(src.materialsCost),
    durationHours: half(src.durationHours),
    hours: half(src.hours),
  });
  const halfMaterials = (list, forNeighbour) =>
    (list || []).map((m) => {
      const qty = Number(m.qty) || 0;
      const h = r2(qty / 2);
      return { ...m, ...(forNeighbour ? { id: newId() } : {}), qty: forNeighbour ? r2(qty - h) : h };
    });
  const note = "This is half of a shared fence; the other half is quoted to the neighbour separately.";
  return {
    mine: { ...q, items: mine, ...halfFields(q), materialsBreakdown: q.materialsBreakdown ? halfMaterials(q.materialsBreakdown, false) : q.materialsBreakdown, notes: withNote(q.notes, note) },
    theirs: {
      ...q,
      ...neighbourFields(neighbour),
      id,
      inserted_at: undefined,
      docNumber,
      items: theirs,
      ...halfFields(q),
      materialsBreakdown: q.materialsBreakdown ? halfMaterials(q.materialsBreakdown, true) : q.materialsBreakdown,
      status: "Draft",
      date: today,
      startDate: "",
      validUntil: null,
      acceptedAt: null,
      acceptedByName: null,
      lastFollowUp: null,
      lastEmailed: null,
      notes: withNote(q.notes, note),
    },
  };
}
