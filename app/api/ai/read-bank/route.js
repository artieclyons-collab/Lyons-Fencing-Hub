import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { parseJson } from "@/lib/replyDrafts";

export const runtime = "nodejs";
export const maxDuration = 60;

// Screenshots of bank transactions -> [{ date, description, amount }] (money in positive, money out negative). The screenshots go to Claude
// and nowhere else; nothing is stored. (A CSV export is read in the browser and never sent anywhere.)
const SYSTEM = `You read screenshots of a bank or card transaction list (an Australian business account) and copy out every transaction you can see.
Return ONLY raw JSON, no markdown: {"transactions": [{"date": "YYYY-MM-DD", "description": "the text shown for it", "amount": number}]}
Rules: money coming IN is a positive amount, money going OUT is negative. Dates are day/month in Australia: use the year shown, or the current year (the most recent past date) when none is shown. Copy amounts exactly; never guess or invent a transaction; skip anything you can't read clearly.`;

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Not set up: the Anthropic key is missing." }, { status: 501 });
  try {
    const { images, today } = await req.json();
    const pics = (Array.isArray(images) ? images : []).filter((i) => i && i.base64).slice(0, 6);
    if (!pics.length) return NextResponse.json({ error: "Add at least one screenshot." }, { status: 400 });
    const client = new Anthropic();
    const content = [
      ...pics.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType || "image/jpeg", data: i.base64 } })),
      { type: "text", text: `Today is ${String(today || "").slice(0, 10)}. Copy out the transactions.` },
    ];
    const resp = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 3000, system: SYSTEM, messages: [{ role: "user", content }] });
    const out = parseJson((resp.content || []).filter((x) => x.type === "text").map((x) => x.text).join(" "));
    const tx = (Array.isArray(out.transactions) ? out.transactions : [])
      .map((t) => ({ date: String(t.date || "").slice(0, 10), description: String(t.description || "").slice(0, 160), amount: Number(t.amount) }))
      .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number.isFinite(t.amount) && t.amount !== 0);
    return NextResponse.json({ transactions: tx });
  } catch (e) {
    console.log("read-bank failed —", String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: "Couldn't read those screenshots. Try a clearer one, or a CSV export." }, { status: 500 });
  }
}
