// Picks the parts of a text or email that matter for the job, so a lead's notes hold "30m, 1.8m high, raked, easy access from the
// neighbour's driveway" and not the greeting, the thank-yous and the signature.
// Kept: measurements, the job itself (fence, material, gate, removal, rake, footings), access and timing (dogs, key, away, available
// after 3pm), money, who to contact. Dropped: greetings, sign-offs, pleasantries, "photos attached", phone-app signatures.

const MEASURE = /\b\d+(?:\.\d+)?\s*(?:m|mm|metres?|meters?|lm|kg)\b|\b(?:height|high|long|length|wide|width|deep|fall|slope)\b/i;
const JOB = /\b(?:fenc\w*|colou?rbond|timber|aluminium|alumin\w*|slats?|gates?|posts?|panels?|palings?|sleepers?|retaining|rak(?:e|ed|ing)|lapped|capped|good\s+neighbou?r|boundary|footings?|concrete|remov\w*|replac\w*|install\w*|supply\w*|repair\w*|renovat\w*|extend\w*|quote|quoting|estimate|pool|driveway|neighbou?rs?|neighbor|shed|wall|brick|render|screen\w*|privacy|height|gaps?|capping)\b/i;
const LOGISTICS = /\b(?:dogs?|pets?|cat|access|keys?|locked|lockbox|home|away|overseas|travelling|available|availability|free|after\s+\d|before\s+\d|weekends?|weekdays?|saturday|sunday|monday|tuesday|wednesday|thursday|friday|morning|afternoon|tomorrow|next\s+week|few\s+weeks|starting|start|asap|urgent|budget|cost|price|\$\s?\d|deposit|council|approval|permit|owner|landlord|tenant|agent|number|phone|call|text|coordinate)\b/i;
const PLEASANTRY = /^(?:thanks|thank\s+you|thankyou|cheers|regards|kind\s+regards|many\s+thanks|no\s+problem|sounds\s+good|that\s+works|ok|okay|yep|yes|yeah|great|perfect|awesome|sorry|please\s+let\s+me\s+know|let\s+me\s+know|talk\s+soon|speak\s+soon|look\s+forward|have\s+a\s+(?:great|good|nice)|photos?\s+(?:attached|are\s+attached)|see\s+attached|sent\s+from)\b/i;
const GREETING = /^(?:hi|hello|hey|g'?day|dear|morning|good\s+(?:morning|afternoon|evening))(?:\s+(?:there|artie|mate|team|lyons|fencing))*[\s,!.:-]+/i;

const clean = (s) => s.replace(/\s+/g, " ").replace(/^[-•*–]+\s*/, "").replace(/^\d+[.)]\s+/, "").trim();

// -> the relevant sentences, one per line ("" when there's nothing useful in the message)
// Splits at the end of a sentence (".", "!" or "?" followed by a space), never inside a number like 1.8m, and at inline bullets (" - About…").
function sentences(line) {
  const parts = [];
  const bits = line.split(/\s+[-•]\s+(?=[A-Z])/);
  for (const bit of bits) {
    let cur = "";
    for (let i = 0; i < bit.length; i++) {
      cur += bit[i];
      if (/[.!?]/.test(bit[i]) && (i === bit.length - 1 || /\s/.test(bit[i + 1]))) {
        if (cur.trim()) parts.push(cur.trim());
        cur = "";
      }
    }
    if (cur.trim()) parts.push(cur.trim());
  }
  return parts;
}

export function relevantParts(text, { max = 700 } = {}) {
  const raw = String(text || "")
    .replace(/\r/g, "")
    .replace(/[​-‍﻿]/g, "")
    .split("\n")
    .filter((l) => !/^\s*(?:sent from my|get outlook|sent via|--\s*$)/i.test(l))
    .join("\n");
  const pieces = [];
  for (const line of raw.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    // a bullet or short line is one piece; longer text is split into sentences
    if (l.length <= 140 || /^[-•*–]/.test(l)) pieces.push(l);
    else pieces.push(...sentences(l));
  }
  const out = [];
  for (const p of pieces) {
    let s = clean(p).replace(GREETING, "").trim();
    s = s.replace(/\s*(?:thanks|thank you|cheers|regards|kind regards)[,.! ]*[A-Za-z]*\.?$/i, "").trim();
    if (s.length < 4) continue;
    const hasNumber = /\d/.test(s);
    if (PLEASANTRY.test(s) && s.length < 70 && !hasNumber) continue;
    if (/^(?:please\s+)?(?:confirm|let\s+me\s+know)\b/i.test(s) && !JOB.test(s)) continue;
    if (!(MEASURE.test(s) || JOB.test(s) || LOGISTICS.test(s))) continue;
    if (/^(?:is|are|do|does|can|could|would)\s+you\b/i.test(s) && !JOB.test(s) && !MEASURE.test(s)) continue;
    const t = s.replace(/[\s,;:-]+$/, "");
    if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(/[.!?]$/.test(t) ? t : `${t}.`);
  }
  let joined = out.join("\n");
  if (joined.length > max) {
    const cut = joined.slice(0, max);
    joined = cut.slice(0, Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". ") + 1, 80)).trim();
  }
  return joined;
}
