import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { parseJson } from "@/lib/replyDrafts";

export const runtime = "nodejs";
export const maxDuration = 60;

// A supplier price list (PDF, photo or screenshot) -> { supplier, priceBasis, items: [{ name, unit, price }] }. Claude only copies what's printed:
// the prices are matched to your materials in the browser (lib/priceList.js) and nothing is saved until you apply them.
const SYSTEM = `You read a supplier's price list (a fencing or building supplier in Australia) and copy out each product line.
Return ONLY raw JSON, no markdown: {"supplier": "name or empty", "priceBasis": "ex GST" | "inc GST" | "unknown", "items": [{"name": "the product name exactly as printed, with its size/code", "unit": "each | pack | box | m | bag | etc", "price": number}]}
Rules: price is the unit price for ONE of the listed unit, as a plain number. Copy names exactly (keep codes, sizes, colours). Skip headings, freight, and anything without a price. Never guess a price. priceBasis is what the list says (trade lists are often ex GST); "unknown" if it doesn't say. At most 200 items.`;

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Not set up: the Anthropic key is missing." }, { status: 501 });
  try {
    const { files } = await req.json();
    const list = (Array.isArray(files) ? files : []).filter((f) => f && f.base64).slice(0, 4);
    if (!list.length) return NextResponse.json({ error: "Add a price list first." }, { status: 400 });
    const blocks = list.map((f) => (f.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 } }
      : { type: "image", source: { type: "base64", media_type: f.mediaType || "image/jpeg", data: f.base64 } }));
    const client = new Anthropic();
    const resp = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 6000, system: SYSTEM, messages: [{ role: "user", content: [...blocks, { type: "text", text: "Copy out the price list." }] }] });
    const out = parseJson((resp.content || []).filter((x) => x.type === "text").map((x) => x.text).join(" "));
    const items = (Array.isArray(out.items) ? out.items : [])
      .map((i) => ({ name: String(i.name || "").trim().slice(0, 140), unit: String(i.unit || "each").slice(0, 20), price: Number(i.price) }))
      .filter((i) => i.name && Number.isFinite(i.price) && i.price >= 0)
      .slice(0, 200);
    return NextResponse.json({ supplier: String(out.supplier || "").slice(0, 60), priceBasis: ["ex GST", "inc GST"].includes(out.priceBasis) ? out.priceBasis : "unknown", items });
  } catch (e) {
    console.log("read-pricelist failed —", String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: "Couldn't read that price list. Try a clearer photo, or fewer pages." }, { status: 500 });
  }
}
