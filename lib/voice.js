"use client";
// Speaking to the hub and having it speak back, using what the phone/browser already has (nothing is uploaded for this).
// Safari on iPhone can listen when the hub is open in Safari; some Home Screen apps can't, so the screen also says to use the microphone
// key on the keyboard, which always works. Reading aloud works in both.
//
// How human it sounds depends on the voice installed on the phone. The built-in "compact" voices are robotic; the Enhanced and Premium
// ones (iPhone: Settings > Accessibility > Spoken Content > Voices > English (Australia)) sound a lot like a person. pickVoice() prefers
// those when they're installed, and the Assistant lets you choose one.
export const canListen = () => typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

// start listening; onText(text, isFinal) as words come in; returns { stop }
export function listen({ onText, onEnd, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = "en-AU";
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    let text = "";
    let final = false;
    for (const r of e.results) { text += r[0].transcript; if (r.isFinal) final = true; }
    onText?.(text.trim(), final);
  };
  rec.onerror = (e) => onError?.(e.error || "error");
  rec.onend = () => onEnd?.();
  try { rec.start(); } catch (e) { onError?.("start-failed"); }
  return { stop: () => { try { rec.stop(); } catch {} } };
}

// ---------- voices ----------
const VOICE_KEY = "lyons:voice";
// best first: the ones that sound most like a person
const QUALITY = /premium|enhanced|siri|natural|neural|online/i;
const NICE_AU = /karen|matilda|catherine|lee|james|gordon|isla/i;
const LOW = /compact|novelty|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|kathy|ralph/i;

export function englishVoices() {
  if (!canSpeak()) return [];
  return window.speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang) && !LOW.test(v.name));
}

const score = (v) => {
  let s = 0;
  if (/^en[-_]AU/i.test(v.lang)) s += 100;
  else if (/^en[-_](GB|NZ|IE)/i.test(v.lang)) s += 60;
  else s += 40;
  if (QUALITY.test(v.name)) s += 50;
  if (NICE_AU.test(v.name)) s += 15;
  if (!v.localService) s += 10; // network voices are usually the better ones
  return s;
};

export function pickVoice() {
  const list = englishVoices();
  if (!list.length) return null;
  try {
    const saved = window.localStorage.getItem(VOICE_KEY);
    const mine = saved && list.find((v) => v.voiceURI === saved || v.name === saved);
    if (mine) return mine;
  } catch {}
  return [...list].sort((a, b) => score(b) - score(a))[0];
}
export const chooseVoice = (uri) => { try { window.localStorage.setItem(VOICE_KEY, uri || ""); } catch {} };
// the voice list loads a moment after the page does (and on iPhone only after the first use), so callers can ask to hear when it's ready
export function onVoicesReady(cb) {
  if (!canSpeak()) return () => {};
  const synth = window.speechSynthesis;
  const fire = () => cb(englishVoices());
  fire();
  synth.addEventListener?.("voiceschanged", fire);
  return () => synth.removeEventListener?.("voiceschanged", fire);
}

// iPhone only lets a page speak after a tap. Calling this inside the tap that sends the question lets the answer, which arrives a few
// seconds later, be spoken.
export function unlockSpeech() {
  if (!canSpeak()) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {}
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Written so it reads naturally out loud: "$5,432" -> "5,432 dollars", "LFS529" -> "L F S 5 2 9", "inc GST" -> "including GST"
export function forSpeech(text) {
  return String(text || "")
    .replace(/\$\s?([\d,]+)(?:\.(\d{2}))?/g, (_, w, c) => (c && c !== "00" ? `${w} dollars and ${Number(c)} cents` : `${w} dollars`))
    .replace(/\b(LFS|INV)[-\s]?(\d+)/gi, (_, p, d) => `${p.toUpperCase().split("").join(" ")} ${d.split("").join(" ")}`)
    .replace(/\binc\.? GST\b/gi, "including GST")
    .replace(/\bex\.? GST\b/gi, "excluding GST")
    .replace(/\b(\d+(?:\.\d+)?)\s?m\b/g, "$1 metres")
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => `${Number(d)} ${MONTH_NAMES[Number(m) - 1] || ""} ${y}`)
    .replace(/([.!?:])?\s*\n+\s*/g, (_, p) => `${p && p !== ":" ? p : "."} `)
    .replace(/\.(\s*\.)+/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

let queue = 0;
// speak in sentence-sized pieces (long single utterances get cut off on some phones); onDone fires when the last piece ends
export function speak(text, { onStart, onDone } = {}) {
  if (!canSpeak()) { onDone?.(); return; }
  const synth = window.speechSynthesis;
  try { synth.cancel(); } catch {}
  const pieces = forSpeech(text).match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) || [];
  if (!pieces.length) { onDone?.(); return; }
  const voice = pickVoice();
  const run = ++queue;
  pieces.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "en-AU";
    u.rate = 1;
    u.pitch = 1;
    if (i === 0) u.onstart = () => onStart?.();
    if (i === pieces.length - 1) { u.onend = () => { if (run === queue) onDone?.(); }; u.onerror = () => { if (run === queue) onDone?.(); }; }
    synth.speak(u);
  });
}
export const stopSpeaking = () => { queue++; try { window.speechSynthesis?.cancel(); } catch {} };
