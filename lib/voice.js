"use client";
// Speaking to the hub and having it read answers back, using what the phone/browser already has (nothing is uploaded for this).
// Safari on iPhone can listen when the hub is open in Safari; some Home Screen apps can't, so the screen also says to use the microphone
// key on the keyboard, which always works. Reading aloud works in both.
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

export function speak(text) {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/\s+/g, " "));
    u.lang = "en-AU";
    u.rate = 1.02;
    window.speechSynthesis.speak(u);
  } catch {}
}
export const stopSpeaking = () => { try { window.speechSynthesis?.cancel(); } catch {} };
