import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Price lookup isn't set up — add an ANTHROPIC_API_KEY to enable it." },
      { status: 501 }
    );
  }
  try {
    const { materialName } = await req.json();
    if (!materialName) return NextResponse.json({ error: "materialName is required" }, { status: 400 });

    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: `Search for the current typical retail price in Australia for this fencing/building material: "${materialName}". Give a short answer: a rough price range, the unit it's sold in, and which retailer(s) the price is from. Keep it to 2-3 sentences, no preamble.`,
        },
      ],
      tools: [{ type: "web_search_20260209", name: "web_search" }],
    });

    const text = (response.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    return NextResponse.json({ text });
  } catch (e) {
    console.error("price-lookup failed", e);
    return NextResponse.json({ error: "Couldn't fetch a price right now — try again shortly." }, { status: 500 });
  }
}
