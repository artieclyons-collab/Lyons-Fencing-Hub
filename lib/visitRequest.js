// A client asking you to come and look at the job ("can you come out and look at the quote in person this week?") is a site visit to plan.
// detectVisitRequest reads a text or email and says whether it's that, and by when (the day they said, or the end of "this week").
// The result goes on the lead as one plain line, "Site visit wanted by 2026-11-21.", which the Visit planner reads (lib/visitData.js).
// Safe for the app screens and the server (no imports).

const ASK = /\b(?:come|coming|pop|popping|swing|swinging|drop|dropping|get)\s+(?:out|by|over|round|around|past|in)\b|\bsite\s+visit\b|\bin[\s-]person\b|\b(?:have|take|get)\s+a\s+(?:look|squiz|quick\s+look)\b|\bcome\s+(?:and\s+)?(?:look|see|measure|check|meet)\b|\bmeet\s+(?:up|on\s*site|you\s+there)\b|\bmeasure\s+up\b|\binspect\b|\bsee\s+(?:the\s+)?(?:site|property|yard|fence|fenceline|fence\s+line)\b/i;
const ABOUT = /\b(?:quote|quotes|look|see|measure|check|inspect|visit|discuss|go\s+over|talk|chat|site|fence|fencing|property|yard|boundary)\b/i;
// "when can you come out to start" is the job, not a quote visit
const STARTING = /\b(?:start|starting|begin|beginning|commence|install(?:ing)?\s+(?:it|the)|do\s+the\s+job|get\s+(?:it|the\s+job)\s+done)\b/i;

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const toMs = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const addDays = (iso, n) => new Date(toMs(iso) + n * 86400000).toISOString().slice(0, 10);
const dow = (iso) => new Date(toMs(iso)).getUTCDay();

// -> null (not a visit request) or { by: "2026-11-21" | null }
export function detectVisitRequest(text, todayIso) {
  const t = String(text || "").replace(/[’‘ʼ]/g, "'");
  const sentences = t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const hit = sentences.find((s) => ASK.test(s) && ABOUT.test(s) && !STARTING.test(s) && !/\bdon'?t\s+(?:need|want)\b|\bno\s+need\b|\bnot\s+(?:needed|necessary)\b/i.test(s));
  if (!hit) return null;
  // the deadline: from the sentence itself, else anywhere in the message ("...in person. Thursday suits me")
  const when = `${hit} ${t}`.toLowerCase();
  let by = null;
  if (/\b(?:today|this\s+(?:arvo|afternoon|morning|evening))\b/.test(when)) by = todayIso;
  else if (/\btomorrow\b/.test(when)) by = addDays(todayIso, 1);
  else {
    const named = DAYS.find((d) => new RegExp(`\\b${d}\\b`).test(when));
    if (named) {
      const next = DAYS.indexOf(named);
      let delta = (next - dow(todayIso) + 7) % 7;
      if (delta === 0) delta = 7;
      by = addDays(todayIso, /\bnext\s+week\b/.test(when) && delta < 3 ? delta + 7 : delta);
    } else if (/\bnext\s+week\b/.test(when)) by = addDays(todayIso, ((6 - dow(todayIso) + 7) % 7 || 7) + 7); // the Saturday of next week
    else if (/\b(?:this\s+week|few\s+days|asap|soon|as\s+soon\s+as)\b/.test(when)) by = addDays(todayIso, (6 - dow(todayIso) + 7) % 7 || 7); // this coming Saturday
  }
  return { by };
}

// the one line that goes on a lead's notes
export const visitWantedLine = (by) => `Site visit wanted${by ? ` by ${by}` : ""}.`;
export const VISIT_WANTED = /^Site visit wanted(?: by (\d{4}-\d{2}-\d{2}))?\.?\s*$/im;
export const NO_VISIT = /^No site visit needed\.?\s*$/im;
export const NO_VISIT_LINE = "No site visit needed.";
