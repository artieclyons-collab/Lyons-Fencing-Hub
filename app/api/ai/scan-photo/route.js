import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Photo scanning isn't set up — add an ANTHROPIC_API_KEY to enable it." },
      { status: 501 }
    );
  }
  try {
    const { base64, mediaType } = await req.json();
    if (!base64) return NextResponse.json({ error: "base64 image data is required" }, { status: 400 });

    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64 } },
            {
              type: "text",
              text: 'This is a photo related to a fencing job — could be a site photo, a hand-drawn sketch with measurements, or a written quote/measurements. Extract what you can and return ONLY raw JSON, no markdown fences, no commentary, in this exact shape: {"style":"timber"|"colorbond"|null,"timberStyle":"butted"|"lapped"|null,"length_m":number|null,"height_m":number|null,"gates":number|null,"notes":"short string with anything else worth flagging, or empty string"}. Use null for anything you truly can\'t determine — don\'t guess.',
            },
          ],
        },
      ],
    });

    const text = (response.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    const cleaned = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    return NextResponse.json({ result: JSON.parse(cleaned) });
  } catch (e) {
    console.error("scan-photo failed", e);
    return NextResponse.json({ error: "Couldn't read that photo." }, { status: 500 });
  }
}
