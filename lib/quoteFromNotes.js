// Site notes (typed, dictated, or read from a photo) -> what to change on a quote that is open on screen. The lines come from the same builder as
// "Start quote" on a lead (lib/leadToQuote.js), so a photo of "26m 1.8 colorbond raked, remove old fence, 1 gate" gives the same draft lines.
// Existing lines are kept (the new ones go after them) and the client's boxes are only filled where they are empty. Pure; the screen applies the patch.
import { quotesFromLead } from "./leadToQuote";

const blank = (v) => !String(v ?? "").trim();

// -> { patch, others, summary } or null when the notes didn't make any quote lines. others = titles of any further quotes the notes also hold.
export function quoteFromNotes(form, notes, client = {}) {
  const f = form || {};
  const drafts = quotesFromLead({
    id: "",
    name: f.clientName || client.name || "",
    phone: f.clientPhone || client.phone || "",
    email: f.clientEmail || client.email || "",
    address: blank(f.address) ? client.address || "" : [f.address, f.suburb].filter(Boolean).join(", "),
    jobType: f.jobType,
    notes: String(notes || ""),
  }).filter((d) => d.items && d.items.length > 0);
  if (!drafts.length) return null;
  const d = drafts[0];
  const hadLines = (f.items || []).length > 0;
  const patch = {
    items: hadLines ? [...f.items, ...d.items] : d.items,
    _draft: d._draft,
  };
  // the client's boxes: only where empty
  if (blank(f.clientName) && !blank(d.clientName)) patch.clientName = d.clientName;
  if (blank(f.clientPhone) && !blank(d.clientPhone)) patch.clientPhone = d.clientPhone;
  if (blank(f.clientEmail) && !blank(d.clientEmail)) patch.clientEmail = d.clientEmail;
  if (blank(f.address) && !blank(d.address)) patch.address = d.address;
  if (blank(f.suburb) && !blank(d.suburb)) patch.suburb = d.suburb;
  if (blank(f.billName) && !blank(d.billName)) patch.billName = d.billName;
  // the job's own details, unless the quote already has lines of its own
  if (!hadLines) patch.jobType = d.jobType;
  if (blank(f.jobLength) && !blank(d.jobLength)) patch.jobLength = d.jobLength;
  if (!hadLines || blank(f.fenceHeight)) patch.fenceHeight = d.fenceHeight || f.fenceHeight || "1.8";
  if (blank(f.notes) && !blank(d.notes)) patch.notes = d.notes;
  return { patch, others: drafts.slice(1).map((x, i) => x._batch?.title || `Quote ${i + 2}`), summary: (d._draft?.summary || []).join(" · ") };
}
