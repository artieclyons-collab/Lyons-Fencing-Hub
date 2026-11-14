import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { EMAIL_SYSTEM, REVIEW_SYSTEM, parseJson, withSignOff } from "@/lib/replyDrafts";

export const runtime = "nodejs";
export const maxDuration = 60;

// kind "email": { clientName, message, facts } -> { subject, body, needs[] }
// kind "review": { stars, review, reviewer } -> { reply }
export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Not set up: the Anthropic key is missing." }, { status: 501 });
  try {
    const b = await req.json();
    const client = new Anthropic();
    const email = b.kind === "email";
    const text = email
      ? `CLIENT: ${String(b.clientName || "unknown").slice(0, 80)}\n\nFACTS ABOUT THEM (from the hub):\n${String(b.facts || "none").slice(0, 3000)}\n\nTHEIR MESSAGE:\n${String(b.message || "").slice(0, 6000)}\n\n${b.instruction ? `ARTIE'S NOTE ON WHAT TO SAY: ${String(b.instruction).slice(0, 500)}` : ""}`
      : `STARS: ${Number(b.stars) || "not given"}\nREVIEWER: ${String(b.reviewer || "not given").slice(0, 60)}\n\nREVIEW:\n${String(b.review || "").slice(0, 3000)}`;
    if (!String(email ? b.message : b.review).trim()) return NextResponse.json({ error: email ? "Paste their email first." : "Paste the review first." }, { status: 400 });
    const resp = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 700,
      system: email ? EMAIL_SYSTEM : REVIEW_SYSTEM,
      messages: [{ role: "user", content: text }],
    });
    const out = parseJson((resp.content || []).filter((x) => x.type === "text").map((x) => x.text).join(" "));
    return NextResponse.json(email ? { subject: String(out.subject || ""), body: withSignOff(out.body), needs: Array.isArray(out.needs) ? out.needs.map(String) : [] } : { reply: String(out.reply || "") });
  } catch (e) {
    console.log("draft-reply failed —", String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: "Couldn't write that just now. Try again." }, { status: 500 });
  }
}
