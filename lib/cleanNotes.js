// Spoken or typed site notes ("twenty six metres of colorbond two metres high take out the old fence one gate and a tree at the end") ->
// the short lines the quote builder reads (lib/siteNotes.js). Claude only tidies what was said; it never adds a measurement or a price. Server only.
import Anthropic from "@anthropic-ai/sdk";
import { parseJson } from "./replyDrafts";

export const CLEAN_NOTES_SYSTEM = `You turn a fencing contractor's spoken or typed site notes into short quote-ready note lines. Spoken numbers become digits ("twenty six metres" -> 26m, "two point one" -> 2.1).
His note style (one fence section per line; a blank line between sections that are separate quotes; otherwise no blank lines):
  26m 1.8 colorbond raked, remove old fence
  Lapped and capped @1.8 no removal Back boundary 23.9m
  18.8m inc gate butted @1.8 no removal
  2.8m Colorbond fence @2m
  1 Colorbond pedestrian gate
  2 posts to replace on the Colorbond fence (rusted at the base, left side near the shed)
  11m front aluminium future fence @1.8
  Right boundary
  Tree removal needed on the fence line.
  Colour: Monument.
Rules: a post repair or post replacement is counted in posts, never metres ("2 posts to replace on the Colorbond fence"), and say which fence (Colorbond or timber) it is on; anything said about which posts, where they are or what is wrong with them goes in brackets at the end of that line, exactly as said (it is printed on the quote). Keep every length, height, material (timber butted / lapped and capped / good neighbour, Colorbond, aluminium, chain wire), raked, sleepers, gates (and which material), old-fence removal or "no removal", boundary side (front/rear/left/right), tree or bush removal, colours, which side the palings face, access notes (dogs, key, slope), and any price he says.
NEVER invent or round a measurement, add a price, or add anything he did not say. If something is unclear, leave it out and list it in "unclear". Use "rear" not "back" for a boundary.
Return ONLY raw JSON, no markdown: {"notes": "the lines, separated by newlines", "unclear": ["short things you could not tell"]}`;

export async function cleanNotes(text) {
  const client = new Anthropic();
  const resp = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 900, system: CLEAN_NOTES_SYSTEM, messages: [{ role: "user", content: String(text).slice(0, 4000) }] });
  const out = parseJson((resp.content || []).filter((x) => x.type === "text").map((x) => x.text).join(" "));
  return { notes: String(out.notes || "").trim(), unclear: Array.isArray(out.unclear) ? out.unclear.map(String).slice(0, 6) : [] };
}
