// "Needs a reply": when a client writes back with a question or something that needs an answer (Yanko asking about the gate options on his quote),
// the hub puts a line on their lead, "Needs a reply (21 Nov): <what they asked>", shows them on the Board, and nags the phone until you tap Replied.
// Replied turns the line into "Replied (21 Nov): ..." so it stops. Safe for the app screens and the server (no imports).
export const NEEDS_REPLY = /^Needs a reply \(([^)]*)\):\s*(.*)$/im;

export function needsReply(notes) {
  const m = NEEDS_REPLY.exec(String(notes || ""));
  return m ? { when: m[1], summary: m[2].trim() } : null;
}

// the notes with that line marked as dealt with
export function markReplied(notes, todayLabel) {
  return String(notes || "").replace(/^Needs a reply \(([^)]*)\):/gim, (_, w) => `Replied (${todayLabel || w}):`);
}

export const needsReplyLine = (when, summary) => `Needs a reply (${when}): ${String(summary || "they wrote back").replace(/\s+/g, " ").trim().slice(0, 160)}`;
