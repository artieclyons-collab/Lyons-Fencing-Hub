// Decides whether a text from a number that isn't a lead yet is someone asking about a fencing job,
// and pulls out what it can (name, suburb/address, kind of job) so a lead can be created from it.
// Deliberately cautious: a text that doesn't mention fencing or a quote is treated as personal and dropped.

// Fencing / trade words that on their own make a text an enquiry.
const TRADE = /\b(?:fenc(?:e|es|ing|ers?)|colou?rbond|palings?|sleepers?|retaining\s+walls?|lapped|gates?|pool\s+fenc\w*|post\s+holes?)\b/i;
// "Can I get a quote" is an enquiry even without a trade word.
const QUOTE = /\b(?:quote|quotes|quoting|quotation|estimate|estimates)\b/i;
// Price questions only count when they also name a place.
const PRICE = /\b(?:how\s+much|price|pricing|prices|cost|costs|ballpark)\b/i;

export const SUBURBS = [
  "Surfers Paradise", "Broadbeach Waters", "Broadbeach", "Burleigh Heads", "Burleigh Waters", "Burleigh", "Mermaid Beach", "Mermaid Waters",
  "Miami", "Palm Beach", "Currumbin Waters", "Currumbin Valley", "Currumbin", "Tallebudgera Valley", "Tallebudgera", "Elanora", "Tugun", "Bilinga",
  "Coolangatta", "Kirra", "Varsity Lakes", "Robina", "Reedy Creek", "Mudgeeraba", "Merrimac", "Carrara", "Nerang", "Southport", "Main Beach",
  "Labrador", "Biggera Waters", "Runaway Bay", "Paradise Point", "Hope Island", "Sanctuary Cove", "Helensvale", "Coomera", "Oxenford", "Pimpama",
  "Ormeau", "Upper Coomera", "Arundel", "Ashmore", "Benowa", "Bundall", "Clear Island Waters", "Highland Park", "Molendinar", "Parkwood", "Pacific Pines",
  "Worongary", "Advancetown", "Gaven", "Mount Nathan", "Austinville", "Springbrook", "Bonogin", "Stephens", "Tweed Heads", "Tweed Heads South",
  "Banora Point", "Terranora", "Kingscliff", "Pottsville", "Murwillumbah", "Cobaki", "Piggabeen", "Bahrs Scrub", "Yatala", "Stapylton", "Jacobs Well",
  "Maudsland", "Wongawallan", "Guanaba", "Beechmont", "Canungra", "Tamborine", "Mount Tamborine", "Coombabah", "Hollywell", "Sorrento", "Surfers",
].sort((a, b) => b.length - a.length); // longest first, so "Burleigh Heads" wins over "Burleigh"

const STREET = /\b\d{1,4}(?:\/\d{1,4})?(?:-\d{1,4})?\s+[A-Za-z][A-Za-z' ]{1,30}?\s+(?:st|street|rd|road|av|ave|avenue|dr|drive|ct|crt|court|cres|crescent|pde|parade|cl|close|pl|place|way|lane|ln|blvd|bvd|boulevard|tce|terrace|cct|cir|circuit|esp|esplanade|hwy|highway|grove|gr|loop|rise|view|walk|retreat|ridge|vista|heights|bend|track|trail|chase|row|glade|mews|outlook|promenade|prom|link|run|pass)\b/i;

const NOT_A_NAME = new Set(["a", "an", "the", "just", "looking", "after", "wondering", "hoping", "interested", "keen", "not", "so", "after", "in", "from", "at", "here", "your", "after", "getting", "enquiring", "inquiring", "contacting", "texting", "messaging", "calling", "chasing", "needing", "wanting", "trying", "after", "about", "with", "for", "one", "sorry", "good", "great", "after", "available", "free", "ok", "okay", "yes", "no", "hi", "hey", "hello", "gday", "day", "can", "could", "would", "will", "do", "did", "need", "want", "wanted", "please", "and", "ive", "have", "hope", "hoping", "was", "got", "after", "i", "we", "my", "our", "thanks", "thank", "mate", "artie"]);

const titleCase = (s) => s.toLowerCase().replace(/(^|\s)([a-z])/g, (_, a, b) => a + b.toUpperCase());

function findName(text) {
  const patterns = [
    /\b(?:my\s+name\s+is|my\s+name'?s|name\s+is|this\s+is|it'?s|its|i\s+am|i'?m|im)\s+([A-Za-z]{2,15})(?:\s+([A-Z][a-z]{2,15}))?/i,
    /^\W*(?:hi|hey|hello|g'?day|hiya)?\W*\s*([A-Za-z]{2,15})\s+here\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && !NOT_A_NAME.has(m[1].toLowerCase())) {
      // A second word only counts as a surname when it was written with a capital.
      const second = m[2] && !NOT_A_NAME.has(m[2].toLowerCase()) && /^[A-Z]/.test(m[2]) ? ` ${m[2]}` : "";
      return titleCase(`${m[1]}${second}`);
    }
  }
  return null;
}

function findSuburb(text) {
  const lower = text.toLowerCase();
  for (const s of SUBURBS) {
    const re = new RegExp(`\\b${s.toLowerCase().replace(/\s+/g, "\\s+")}\\b`);
    if (re.test(lower)) return s;
  }
  return null;
}

function findJobType(text) {
  const t = text.toLowerCase();
  if (/colou?rbond|steel/.test(t)) return "Colorbond";
  if (/retaining/.test(t)) return "Retaining wall";
  if (/\bgates?\b/.test(t)) return "Gates";
  if (/repair|fix|broken|storm|fallen|leaning/.test(t)) return "Repairs";
  if (/timber|pine|paling|lapped|capped|sleeper|treated/.test(t)) return "Timber fencing";
  return "Other";
}

// -> { isEnquiry, name, address, jobType }
export function detectEnquiry(text) {
  // iPhones type curly apostrophes (it’s); the patterns below use the straight kind.
  const s = String(text || "").replace(/[’‘ʼ]/g, "'").trim();
  if (!s) return { isEnquiry: false };
  const suburb = findSuburb(s);
  const street = STREET.exec(s)?.[0] || null;
  const isEnquiry = TRADE.test(s) || QUOTE.test(s) || (PRICE.test(s) && !!(suburb || street));
  if (!isEnquiry) return { isEnquiry: false };
  const address = [street, suburb].filter(Boolean).join(", ");
  return { isEnquiry: true, name: findName(s), address, jobType: findJobType(s) };
}

// 0412 345 678 / +61 412 345 678 -> "0412345678"
export function localPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("61") && d.length === 11) return `0${d.slice(2)}`;
  return d;
}

// An address written in a text ("16 Glentrees Grove, Currumbin Waters") -> { street, suburb, full } or null.
// Needs a house number and a street type, so "see you at 3" or "a 20m fence" never counts.
export function extractAddress(text) {
  const t = String(text || "").replace(/[’‘]/g, "'");
  const m = STREET.exec(t);
  if (!m) return null;
  const street = m[0].replace(/\s+/g, " ").trim();
  const after = t.slice(m.index + m[0].length);
  let suburb = findSuburb(after) || findSuburb(t);
  if (!suburb) {
    // an unknown suburb: whatever follows a comma, up to the end of the sentence
    const c = /^\s*,\s*([A-Za-z][A-Za-z ]{2,28}?)(?=[.,!?\n]|\s+(?:qld|nsw)\b|$)/.exec(after);
    if (c) suburb = c[1].trim().replace(/\b\w/g, (x) => x.toUpperCase());
  }
  return { street, suburb: suburb || "", full: suburb ? `${street}, ${suburb}` : street };
}
