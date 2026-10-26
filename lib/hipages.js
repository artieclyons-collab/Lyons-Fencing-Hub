// Turns the "hipages Job Details" email (sent when you accept a hipages lead) into a hub lead.
// Only that one kind of email is used: from hipages, with "Job Details" in the subject. Everything else in the inbox is ignored.
//
// The email body reads like:
//   Here are the details for the recent lead you accepted.
//   Des Williams Tugun, 4224          <- name and suburb run together, then the postcode
//   0418656533
//   gladfran5@gmail.com
//   Send a message to Des
//   Category: Timber Fencing
//   Description: We need an old wooden fence removed …
//   Type of fencing job: Replace existing fence
//   Approximate length of fence: 15 - 30 m
//   Do you need a gate?: No
import { SUBURBS, localPhone, findJobType } from "./enquiry";

// Is this email one we should read? (from hipages, and a job-details email — not an invitation, reminder or message notice)
export function isJobDetails({ from, subject }) {
  const domain = String(from || "").toLowerCase().split("@").pop().replace(/[^a-z0-9.-]/g, "");
  return /(^|\.)hipages\.com\.au$/.test(domain) && /\bjob details\b/i.test(String(subject || ""));
}

const tail = (s) => String(s || "").replace(/\D/g, "").slice(-9);

// "Des Williams Tugun" -> { name: "Des Williams", suburb: "Tugun" }. A suburb we know wins; otherwise the last word is the suburb
// (the last two when there are four or more words, e.g. "Des Williams Mount Gravatt").
function splitNameSuburb(line) {
  const words = line.split(/\s+/).filter(Boolean);
  const lower = ` ${line.toLowerCase()} `;
  for (const s of SUBURBS) {
    if (lower.endsWith(` ${s.toLowerCase()} `) && words.length > s.split(/\s+/).length) {
      const n = s.split(/\s+/).length;
      return { name: words.slice(0, words.length - n).join(" "), suburb: words.slice(-n).join(" ") };
    }
  }
  if (words.length <= 1) return { name: line, suburb: "" };
  if (words.length === 2) return { name: words[0], suburb: words[1] };
  if (words.length === 3) return { name: words.slice(0, 2).join(" "), suburb: words[2] };
  return { name: words.slice(0, 2).join(" "), suburb: words.slice(2).join(" ") };
}

const stateFor = (postcode) => (/^2/.test(postcode) ? "NSW" : "QLD");
const brisbaneDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(d);

// -> a lead row ready to save, or null when the email isn't a job-details email we can read (no name or no way to contact them).
// receivedAt: when the email arrived. key: something unique to the email (its message id), used for the id only when there's no phone.
export function parseJobDetails({ subject, text, receivedAt = new Date(), key = "" }) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const nameIdx = lines.findIndex((l) => /^.{2,60},\s*\d{4}$/.test(l) && !/:/.test(l));
  if (nameIdx < 0) return null;
  const m = /^(.+?),\s*(\d{4})$/.exec(lines[nameIdx]);
  let { name, suburb } = splitNameSuburb(m[1]);
  const postcode = m[2];
  // The subject carries the first name ("hipages Job Details - Des"); use it to double-check the split.
  const subjectName = (/-\s*(.+)$/.exec(String(subject || "")) || [])[1]?.trim();
  if (subjectName && !name.toLowerCase().startsWith(subjectName.toLowerCase().split(/\s+/)[0])) name = [subjectName, name].join(" ");

  const after = lines.slice(nameIdx + 1);
  const phoneLine = after.slice(0, 6).find((l) => /^\+?[\d\s()-]{8,16}$/.test(l));
  const emailLine = after.slice(0, 8).find((l) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l) && !/hipages/i.test(l));
  const phone = phoneLine ? localPhone(phoneLine) : "";
  const email = emailLine ? emailLine.toLowerCase() : "";
  if (!name || (!phone && !email)) return null;

  // "Label: value" lines, with any wrapped continuation joined onto the line before it. Stops at the footer.
  const fields = [];
  let started = false;
  for (const l of after) {
    if (/^australia'?s|^hipages group/i.test(l)) break;
    const kv = /^([A-Z][^:]{1,60}):\s*(.*)$/.exec(l);
    if (kv) { started = true; fields.push([kv[1].trim(), kv[2].trim()]); continue; }
    if (started && fields.length) fields[fields.length - 1][1] = `${fields[fields.length - 1][1]} ${l}`.trim();
  }
  const get = (re) => fields.find(([k]) => re.test(k))?.[1] || "";
  const category = get(/^category$/i);
  const description = get(/^description$/i);
  const extras = fields.filter(([k]) => !/^(category|description)$/i.test(k));

  let jobType = findJobType(category);
  if (jobType === "Other") jobType = findJobType(description);

  // The notes keep only what's useful for quoting: what they asked for in their own words, plus any extra answer that adds something.
  // Left out: the "hipages lead" header, the category (the job type holds it), "No" answers, a length range when they gave an exact length,
  // and answers that just repeat the description ("Replace existing fence" under "Replace fence …").
  const NEGATIVE = /^(?:no|none|n\/a|nil|not sure|unsure|-+)$/i;
  const gaveLength = /\d+(?:\.\d+)?\s*(?:m|mtrs?|metres?|meters?|lm)\b/i.test(description);
  const repeats = (value) => {
    const words = String(value).toLowerCase().match(/[a-z]{4,}/g) || [];
    return words.length > 0 && words.filter((w) => description.toLowerCase().includes(w.slice(0, 5))).length / words.length >= 0.5;
  };
  const useful = extras
    .filter(([k, v]) => v && !NEGATIVE.test(v) && !(/length/i.test(k) && gaveLength) && !repeats(v))
    .map(([k, v]) => (/gate/i.test(k) ? `Gate: ${v}` : `${k}: ${v}`));
  const notes = [description || category, ...useful].filter(Boolean).join("\n").slice(0, 2000);

  const id = tail(phone).length === 9 ? `hip${tail(phone)}` : `hip${String(key || email || name).replace(/[^A-Za-z0-9]/g, "").slice(0, 24).toLowerCase()}`;
  return {
    id,
    name,
    phone,
    email: email || null,
    address: suburb ? `${suburb} ${stateFor(postcode)} ${postcode}` : postcode,
    jobType,
    status: "New",
    notes,
    createdAt: brisbaneDay(receivedAt),
    source: "hipages",
  };
}
