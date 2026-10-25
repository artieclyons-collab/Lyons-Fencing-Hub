// Turns a lead into the starting details of a quote, so a quote never begins from a blank form.
import { JOB_TYPES } from "./constants";
import { SUBURBS } from "./enquiry";
import { parseSiteJobs } from "./siteNotes";
import { ownNotes } from "./availability";
import { uid, suggestedNotes } from "./logic";

const NO_ADDRESS = /^(n\/?a|none|-|tbc|tba|unknown)$/i;

// "5 Test St, Robina" / "2/16 Gardendale Crescent Burleigh Waters" / "Robina" -> { address, suburb }
export function splitAddress(raw) {
  const a = String(raw || "").trim().replace(/\s+/g, " ");
  if (!a || NO_ADDRESS.test(a)) return { address: "", suburb: "" };
  // Ends with a suburb we know (optionally followed by QLD/NSW and a postcode).
  for (const s of SUBURBS) {
    const re = new RegExp(`(?:^|[,\\s])${s.replace(/\s+/g, "\\s+")}\\s*(?:,?\\s*(?:QLD|NSW))?\\s*\\d{0,4}\\s*$`, "i");
    const m = re.exec(a);
    if (m) return { address: a.slice(0, m.index).replace(/[,\s]+$/, ""), suburb: s };
  }
  // Otherwise a last comma-separated part with no digits is taken as the suburb.
  const parts = a.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1 && !/\d/.test(parts[parts.length - 1])) return { address: parts.slice(0, -1).join(", "), suburb: parts[parts.length - 1] };
  return { address: a, suburb: "" };
}

// "Haydn (site visit)" -> "Haydn", "Sandy ?" -> "Sandy"
export const cleanLeadName = (name) => String(name || "").replace(/\(.*?\)/g, "").replace(/\?/g, "").replace(/\s+/g, " ").trim();

// Everything a quote can take from a lead. `_fromLeadId` lets the app mark the lead Quoted when the quote is saved
// (it isn't a stored column, so it never reaches the database).
const NSW = new Set(["tweed heads", "tweed heads south", "banora point", "terranora", "kingscliff", "pottsville", "murwillumbah", "cobaki", "piggabeen"]);

// One or more quotes from a lead. Site notes written on the lead ("26m 1.8 colorbond raked / remove old fence / 1 gate") become the draft
// lines. If the notes hold several quotes (paragraphs separated by a blank line, e.g. "Left side", "Right side", "Front fence"), each one
// is its own draft; they carry _batch ({ index, total, title, titles }) so the screen can open them one after another.
export function quotesFromLead(lead) {
  const { address, suburb } = splitAddress(lead.address);
  const base = {
    clientName: cleanLeadName(lead.name),
    clientPhone: lead.phone || "",
    clientEmail: lead.email || "",
    address,
    // Quotes read "Burleigh Heads QLD 4220", so the state goes on when the suburb is one we know.
    suburb: suburb && SUBURBS.includes(suburb) ? `${suburb} ${NSW.has(suburb.toLowerCase()) ? "NSW" : "QLD"}` : suburb,
    jobType: JOB_TYPES.includes(lead.jobType) ? lead.jobType : JOB_TYPES[0],
    items: [],
    _fromLeadId: lead.id,
  };
  const drafts = parseSiteJobs(ownNotes(lead.notes), { jobType: lead.jobType }, uid).filter((d) => d.items.length > 0);
  if (drafts.length === 0) return [base];
  const titles = drafts.map((d, i) => d.title || `Quote ${i + 1}`);
  return drafts.map((draft, i) => {
    const jobType = draft.jobType || base.jobType;
    return {
      ...base,
      jobType,
      items: draft.items,
      jobLength: draft.jobLength ? String(draft.jobLength) : "",
      fenceHeight: draft.fenceHeight || "1.8",
      notes: suggestedNotes(jobType, draft.jobLength, draft.items).join("\n"),
      _draft: { summary: draft.summary, assumptions: draft.assumptions, needsPrice: draft.needsPrice },
      ...(drafts.length > 1 ? { _batch: { index: i + 1, total: drafts.length, title: titles[i], titles } } : {}),
    };
  });
}

// The first (usually only) quote from a lead.
export const quoteFromLead = (lead) => quotesFromLead(lead)[0];
