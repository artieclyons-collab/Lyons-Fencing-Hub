// Which side the palings face on a timber fence: the client's side or the neighbour's. It has to be known before the job starts, so it's
// kept as one line in the quote's notes (no database change) and shows on the quote the client sees:
//   "Palings face the client's side."  /  "Palings face the neighbour's side."  /  "Palings side to be confirmed before works commence…"
export const SIDE_CLIENT = "Palings face the client's side.";
export const SIDE_NEIGHBOUR = "Palings face the neighbour's side.";
export const SIDE_UNCONFIRMED = "Palings side to be confirmed before works commence: please let us know which side the palings should face (your side or the neighbour's).";
export const ASKED_SIDE = "Asked which side the palings face";

const LINES = { client: SIDE_CLIENT, neighbour: SIDE_NEIGHBOUR, unconfirmed: SIDE_UNCONFIRMED };

// a timber paling fence quote
export const isPalingQuote = (q) => /timber/i.test(q?.jobType || "") || (q?.items || []).some((it) => /paling/i.test(it.desc || ""));

// -> "client" | "neighbour" | "unconfirmed" | "" (nothing about it in the notes)
export function palingSide(notes) {
  const n = String(notes || "");
  if (/Palings face the client'?s side/i.test(n)) return "client";
  if (/Palings face the neighbour'?s side/i.test(n)) return "neighbour";
  if (/Palings side to be confirmed/i.test(n)) return "unconfirmed";
  return "";
}

// the notes with the side line set ("" removes it)
export function setPalingSide(notes, side) {
  const lines = String(notes || "").split("\n").filter((l) => !/^Palings face the (?:client|neighbour)'?s side\.?$/i.test(l.trim()) && !/^Palings side to be confirmed/i.test(l.trim()));
  if (LINES[side]) lines.push(LINES[side]);
  return lines.join("\n").replace(/^\n+/, "");
}

// "palings facing the neighbour", "good side to face the neighbours", "neat side facing us" in site notes -> "client" | "neighbour" | ""
const FACING = /(?:pal(?:ing)?s?|good\s+side|neat\s+side|finished\s+side|pretty\s+side)\s+(?:(?:is|are|to|will|should|must)\s+)?(?:be\s+)?(?:face|facing|faces)\s+(?:towards?\s+|to\s+|the\s+)?(neighbou?rs?|client|us|me|my|our|house|home|inside)/i;
export function detectFacing(text) {
  const m = String(text || "").match(FACING);
  if (!m) return "";
  return /neighbou?r/i.test(m[1]) ? "neighbour" : "client";
}
