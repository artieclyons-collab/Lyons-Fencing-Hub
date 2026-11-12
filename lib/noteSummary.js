// Keeps a lead's notes short. The enquiry itself (the job description) stays as it is; every later message from the client is folded
// into ONE running line instead of being added as its own "Text …" line:
//     Updates (latest 12 Nov): <what's new, newest first, a sentence or two>
// With ANTHROPIC_API_KEY set, Claude rewrites that line to take in the new message. Without it, the useful sentence or two of each
// message is kept (greetings, thank-yous and signatures dropped, near-duplicates skipped) and only the last three are kept.
import Anthropic from "@anthropic-ai/sdk";

export const UPDATES_PREFIX = /^Updates \(latest [^)]*\):\s*/;
const MAX_SNIPPETS = 3;
const MAX_SNIPPET_CHARS = 150;
const MAX_LINE_CHARS = 380;

// A sentence that's only manners, or about the email itself.
const FILLER = /^(?:hi|hello|hey|dear|g'?day|thanks|thank\s*you|cheers|regards|kind\s+regards|many\s+thanks|no\s+(?:worries|problems?)|sounds\s+good|that\s+works|great|perfect|awesome|sorry|please\s+let\s+me\s+know|let\s+me\s+know|hope\b|talk\s+soon|speak\s+soon|look(?:ing)?\s+forward|have\s+a\b|resending|i\s+am\s+having\s+email|sent\s+from|photos?\b.*attached|see\s+attached)/i;

const tokens = (s) => new Set(String(s || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []);
const overlap = (a, b) => {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / A.size;
};

// the useful sentence or two of a message, cut to a sensible length ("" when there's nothing worth keeping)
export function gist(text) {
  let t = String(text || "")
    .replace(/\r/g, "")
    .replace(/_{3,}[\s\S]*$/, "") // a "________" line starts a quoted/signature block
    .replace(/\s*\n\s*/g, " ")
    .replace(/(?:sent from my [^.]*|get outlook for .*)$/i, "")
    .replace(/(?:cheers|regards|kind regards|thanks|thank you|many thanks)[,.!]?\s*[A-Z][a-z]*\s*$/i, "") // "Cheers,Terry" at the end
    .replace(/([a-z?!.])([A-Z][a-z]+,)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).map((s) => s.trim()).filter(Boolean);
  const keep = sentences.filter((s) => s.length >= 12 && !FILLER.test(s));
  if (!keep.length) return "";
  let out = "";
  for (const s of keep) {
    if ((out + " " + s).trim().length > MAX_SNIPPET_CHARS && out) break;
    out = (out + " " + s).trim();
  }
  if (out.length > MAX_SNIPPET_CHARS) out = out.slice(0, MAX_SNIPPET_CHARS).replace(/\s+\S*$/, "") + "…";
  return out;
}

function heuristicMerge(prior, text, when) {
  const g = gist(text);
  if (!g) return null;
  const snippets = prior ? prior.split(" | ").filter(Boolean) : [];
  const bare = (s) => s.replace(/^\d{1,2} [A-Za-z]{3}:\s*/, "");
  if (snippets.some((s) => overlap(g, bare(s)) >= 0.6)) return null; // already noted (or resent)
  snippets.push(`${when}: ${g}`);
  return snippets.slice(-MAX_SNIPPETS).join(" | ");
}

async function aiMerge(jobLines, prior, text, when) {
  if (!process.env.ANTHROPIC_API_KEY) return undefined; // not set up: use the plain version
  try {
    const client = new Anthropic({ timeout: 15000, maxRetries: 0 });
    const res = await client.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 300,
      system:
        "You keep short running notes for a fencing business owner about one customer enquiry. You are given the job description, the notes so far (may be empty) and a new message from the customer. " +
        "Reply with the updated notes only: one to three short plain sentences (under 300 characters in total) that merge the old notes and the new message, newest facts first. " +
        "Keep dates, times, addresses, access details (gate, dogs, keys), changes, decisions and open questions. Drop greetings, thanks, signatures, repeated information, and anything already in the job description. " +
        "Never invent anything. If the new message adds nothing useful, reply with exactly NO_CHANGE.",
      messages: [{ role: "user", content: `Job description:\n${jobLines.slice(0, 700)}\n\nNotes so far: ${prior || "(none)"}\n\nNew message (${when}):\n${String(text).slice(0, 1500)}` }],
    });
    const out = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").replace(/\s+/g, " ").trim();
    if (!out) return undefined;
    if (/^NO_CHANGE\b/i.test(out)) return null;
    return out.slice(0, MAX_LINE_CHARS);
  } catch (e) {
    console.log("note summary: AI unavailable, using the plain version —", String(e?.message || e).slice(0, 100));
    return undefined;
  }
}

// -> the notes with this message folded into the one "Updates" line (the same notes when it adds nothing)
export async function foldUpdate(notes, { text, when }) {
  const lines = String(notes || "").split("\n");
  const idx = lines.findIndex((l) => UPDATES_PREFIX.test(l));
  const prior = idx >= 0 ? lines[idx].replace(UPDATES_PREFIX, "") : "";
  const jobLines = lines.filter((l, i) => i !== idx).join("\n");
  let merged = await aiMerge(jobLines, prior, text, when);
  if (merged === undefined) merged = heuristicMerge(prior, text, when);
  if (!merged || merged === prior) return String(notes || "");
  const line = `Updates (latest ${when}): ${merged}`;
  if (idx >= 0) lines[idx] = line;
  else lines.push(line);
  return lines.join("\n").replace(/^\n+/, "");
}
