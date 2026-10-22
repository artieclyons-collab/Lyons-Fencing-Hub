// Understands availability written in plain words — in a lead's notes or a pasted text message —
// so the visit planner can respect it ("from 3:30pm onwards", "before 2", "not before 3.30").
// Times are minutes since midnight. (No regex look-behind: older iPhones can't run it.)

const TIME = "(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?";

// "3" with no am/pm: tradies visit in daylight, so 1–7 means pm and 8–11 means am.
function toMinutes(h, m, ap) {
  let hour = Number(h);
  const min = m ? Number(m) : 0;
  if (hour > 23 || min > 59) return null;
  const mer = ap ? ap.replace(/\./g, "").toLowerCase() : null;
  if (mer === "pm" && hour < 12) hour += 12;
  else if (mer === "am" && hour === 12) hour = 0;
  else if (!mer && hour >= 1 && hour <= 7) hour += 12;
  return hour * 60 + min;
}

const AFTER = new RegExp(`\\b(?:available\\s+from|free\\s+from|from|after|not\\s+before|no\\s+earlier\\s+than|any\\s*time\\s+after|earliest|(?:home|back|free|available|there|around|off)\\s+by)\\s+${TIME}(?:\\s*(?:onwards?|on|and\\s+later|or\\s+later))?`, "i");
const BEFORE = new RegExp(`\\b(?:before|until|till|(?:done|finished|completed|over|gone|out|leave|left)\\s+by|no\\s+later\\s+than|not\\s+after|latest)\\s+${TIME}`, "i");
const NOT_RIGHT_BEFORE = new RegExp("\\b(?:not|no)\\s*$", "i");

// First match that isn't a bare "before"/"after" with "not"/"no" right in front of it
// ("not before 3" means the opposite of "before 3").
function firstMatch(re, s) {
  const g = new RegExp(re.source, "gi");
  let m;
  while ((m = g.exec(s))) {
    const lead = s.slice(Math.max(0, m.index - 5), m.index);
    if (!NOT_RIGHT_BEFORE.test(lead)) return m;
  }
  return null;
}

// -> { notBefore: minutes|null, notAfter: minutes|null }
export function parseAvailability(text) {
  const s = String(text || "");
  const a = firstMatch(AFTER, s);
  const b = firstMatch(BEFORE, s);
  return {
    notBefore: a ? toMinutes(a[1], a[2], a[3]) : null,
    notAfter: b ? toMinutes(b[1], b[2], b[3]) : null,
  };
}

// Lines the hub adds when you paste or forward a client's text start with "Text ". They're a record of what was said,
// not instructions — only YOUR lines (including the availability sentence made from a text) tell the planner anything.
export const isTextLine = (line) => /^text\b/i.test(String(line).trim());
export const ownNotes = (notes) => String(notes || "").split("\n").filter((l) => !isTextLine(l)).join("\n");

// Availability from a lead's notes: your own lines only, the newest line winning for each of before/after.
export function parseNotesAvailability(notes) {
  let notBefore = null;
  let notAfter = null;
  for (const line of ownNotes(notes).split("\n")) {
    const a = parseAvailability(line);
    if (a.notBefore != null) notBefore = a.notBefore;
    if (a.notAfter != null) notAfter = a.notAfter;
  }
  return { notBefore, notAfter };
}

const fmt = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};

// A tidy sentence the planner (and you) can read back later: "Available from 3:30pm onwards."
export function availabilityNote({ notBefore, notAfter }) {
  const bits = [];
  if (notBefore != null) bits.push(`Available from ${fmt(notBefore)} onwards.`);
  if (notAfter != null) bits.push(`Needs to be done before ${fmt(notAfter)}.`);
  return bits.join(" ");
}

// Replaces any availability sentence already in the notes (so it doesn't pile up) and adds the new one.
export function withAvailability(notes, avail) {
  const cleaned = String(notes || "")
    .split("\n")
    .filter((line) => !/^(available from|needs to be done before)\b/i.test(line.trim()))
    .join("\n")
    .trim();
  const add = availabilityNote(avail);
  return [cleaned, add].filter(Boolean).join("\n");
}

const DAYS = [
  ["sunday", 0], ["sun", 0], ["monday", 1], ["mon", 1], ["tuesday", 2], ["tues", 2], ["tue", 2], ["wednesday", 3], ["wed", 3],
  ["thursday", 4], ["thurs", 4], ["thur", 4], ["thu", 4], ["friday", 5], ["fri", 5], ["saturday", 6], ["sat", 6],
];

// The first day mentioned in a message ("Friday", "tomorrow", "this Saturday") as the next date it falls on, from `today` (ISO).
export function parseDay(text, today) {
  const s = String(text || "").toLowerCase();
  const base = new Date(`${today}T00:00:00Z`);
  const iso = (d) => d.toISOString().slice(0, 10);
  const add = (n) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  };

  let best = null; // { index, date }
  const consider = (index, date) => {
    if (index >= 0 && (!best || index < best.index)) best = { index, date };
  };

  const tm = /\btomorrow\b/.exec(s);
  if (tm) consider(tm.index, add(1));
  const td = /\btoday\b/.exec(s);
  if (td) consider(td.index, add(0));
  for (const [name, dow] of DAYS) {
    const m = new RegExp(`\\b${name}\\b`).exec(s);
    if (!m) continue;
    const ahead = (dow - base.getUTCDay() + 7) % 7; // today itself counts only when "today" is said
    consider(m.index, add(ahead === 0 ? 7 : ahead));
  }
  return best ? iso(best.date) : null;
}

// ---------- cancellations ----------
// Does a text sound like the client no longer wants the quote? Deliberately cautious: a text about moving the
// visit ("can we do Monday instead") is NOT a cancellation, and anything flagged is only ever a suggestion.
const CANCEL_PATTERNS = [
  /\bcancel(?:l?ed|l?ing)?\b/,
  /\bno longer\b[^.!?]{0,30}\b(?:need|want|require|interested|looking)/,
  /\b(?:don'?t|dont|do not|doesn'?t|does not|won'?t|wont|will not)\s+(?:really\s+|actually\s+)?(?:need|want|require)\b[^.!?]{0,25}\b(?:quote|quoting|fence|fencing|job|work|anyone|you|it)\b/,
  /\bnot\s+(?:interested|going ahead|proceeding|needed|needing)\b/,
  /\b(?:no need|not needed|won'?t be needing|wont be needing)\b/,
  /\b(?:already|have|got|found|hired)\s+(?:someone|a guy|another|a different|a fencer|somebody)\b/,
  /\b(?:going|gone)\s+(?:with|elsewhere)\b/,
  /\bchanged\s+(?:my|our)\s+mind\b/,
  /\bdecided\s+(?:not|against)\b/,
];
const RESCHEDULE_PATTERN = /\b(?:re-?schedule|rearrange|postpone|push (?:it )?back|another day|different day|different time|instead|can we (?:do|make it|move)|move (?:it|the|our)|next week|later in the week)\b/;

// -> { cancelled: bool, reschedule: bool }
export function detectCancellation(text) {
  const s = String(text || "").toLowerCase().replace(/[’‘]/g, "'");
  const reschedule = RESCHEDULE_PATTERN.test(s);
  return { cancelled: !reschedule && CANCEL_PATTERNS.some((re) => re.test(s)), reschedule };
}

// If the NEWEST thing in a lead's notes is a client text that sounds like a cancellation, returns that text.
// Once you've dealt with it (removed them, or marked "Checked: ..."), a later line means it's no longer flagged.
export function cancellationHint(notes) {
  const lines = String(notes || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last || !isTextLine(last)) return null;
  const body = last.replace(/^text.*?:\s+/i, ""); // drops "Text 22 Oct 12:46am: " (the first colon followed by a space)
  return detectCancellation(body).cancelled ? body : null;
}
