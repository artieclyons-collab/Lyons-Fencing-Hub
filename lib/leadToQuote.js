// Turns a lead into the starting details of a quote, so a quote never begins from a blank form.
import { JOB_TYPES } from "./constants";
import { SUBURBS } from "./enquiry";

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

export function quoteFromLead(lead) {
  const { address, suburb } = splitAddress(lead.address);
  return {
    clientName: cleanLeadName(lead.name),
    clientPhone: lead.phone || "",
    address,
    // Quotes read "Burleigh Heads QLD 4220", so the state goes on when the suburb is one we know.
    suburb: suburb && SUBURBS.includes(suburb) ? `${suburb} ${NSW.has(suburb.toLowerCase()) ? "NSW" : "QLD"}` : suburb,
    jobType: JOB_TYPES.includes(lead.jobType) ? lead.jobType : JOB_TYPES[0],
    _fromLeadId: lead.id,
  };
}
