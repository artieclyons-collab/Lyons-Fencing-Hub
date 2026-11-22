import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { parseJson } from "@/lib/replyDrafts";
import { CLEAN_NOTES_SYSTEM } from "@/lib/cleanNotes";

export const runtime = "nodejs";
export const maxDuration = 60;

// A photo or screenshot of the details of a job (handwritten site notes, a client's message or email, a sketch with measurements) ->
// the short note lines the quote builder reads (lib/siteNotes.js), plus the client's details if they're shown. Claude only copies what's
// there: it never invents a measurement or a price. The screen shows the notes to check and change before anything becomes quote lines.
const RULES = CLEAN_NOTES_SYSTEM.split("\nReturn ONLY")[0];
const SYSTEM = `${RULES}
The input is one or more PHOTOS or SCREENSHOTS (handwritten site notes, a whiteboard, a sketch with measurements, or a message or email from the client). Read them and write the notes in the style above. Ignore anything that is not about the job or the client. If the picture shows only the client's contact details (a name, number, address or email, for example a contact card or the top of a message) and nothing about the job, return "notes" as "" and still fill in "client".
Also copy the client's name, mobile number, email and the job's street address if they are clearly shown (leave a field "" if not shown).
Return ONLY raw JSON, no markdown: {"notes": "the lines, separated by newlines", "unclear": ["short things you could not read or tell"], "client": {"name": "", "phone": "", "email": "", "address": ""}}`;

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Not set up: the Anthropic key is missing." }, { status: 501 });
  try {
    const { images, note } = await req.json();
    const pics = (Array.isArray(images) ? images : []).filter((i) => i && i.base64).slice(0, 4);
    if (!pics.length) return NextResponse.json({ error: "Add a photo or screenshot first." }, { status: 400 });
    const client = new Anthropic();
    const content = [
      ...pics.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType || "image/jpeg", data: i.base64 } })),
      { type: "text", text: `${note ? `Context: ${String(note).slice(0, 300)}. ` : ""}Write the quote notes from ${pics.length > 1 ? "these photos" : "this photo"}.` },
    ];
    const resp = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 1500, system: SYSTEM, messages: [{ role: "user", content }] });
    const out = parseJson((resp.content || []).filter((x) => x.type === "text").map((x) => x.text).join(" "));
    const c = out.client && typeof out.client === "object" ? out.client : {};
    const clean = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
    return NextResponse.json({
      notes: String(out.notes || "").trim().slice(0, 2000),
      unclear: Array.isArray(out.unclear) ? out.unclear.map((x) => clean(x, 120)).slice(0, 6) : [],
      client: { name: clean(c.name, 60), phone: clean(c.phone, 20), email: clean(c.email, 80), address: clean(c.address, 120) },
    });
  } catch (e) {
    console.log("read-quote failed —", String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: "Couldn't read that. Try a clearer photo, or type the notes in." }, { status: 500 });
  }
}
