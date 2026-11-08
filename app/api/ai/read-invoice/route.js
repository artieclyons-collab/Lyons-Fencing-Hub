// Reads a supplier invoice (a photo, screenshot or PDF: Our Town Fencing, Bunnings, anyone) with Claude and returns the parts the
// hub needs to put the real materials cost on a job. Nothing is saved here; the screen shows the result to check first.
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROMPT = `This is a supplier invoice or receipt for a fencing contractor in Queensland, Australia (Our Town Fencing, Bunnings, a timber yard...). Extract it and return ONLY raw JSON, no markdown fences, no commentary, in exactly this shape:
{"supplier":string,"invoiceNumber":string,"date":"YYYY-MM-DD" or "","deliveryAddress":string,"deliveryIncGst":number,"lines":[{"desc":string,"qty":number,"totalIncGst":number}],"totalIncGst":number,"isOrderOnly":boolean}
Rules:
- Dates are Australian day/month/year (02/11/2026 is 2 November 2026).
- "deliveryAddress" is where the goods were delivered (the street address, no "Delivery Address:" label), or "" if none or it just says "with other order".
- "deliveryIncGst" is the delivery charge line (including GST), 0 if there isn't one. Leave delivery out of "lines".
- "lines" are the goods, each with its quantity and its total including GST. Skip lines that cost $0 and skip notes.
- "totalIncGst" is the invoice total including GST: the goods plus delivery. If the invoice doesn't print a total, add the lines up.
- "isOrderOnly" is true if the document is only an order or quote (quantities "Ordered" rather than "Supplied"), false for a tax invoice or receipt.
Use "" or 0 for anything you can't read. Don't guess.`;

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Reading invoices isn't set up: add an ANTHROPIC_API_KEY." }, { status: 501 });
  try {
    const { base64, mediaType } = await req.json();
    if (!base64) return NextResponse.json({ error: "A file is required" }, { status: 400 });
    const isPdf = /pdf/i.test(mediaType || "");
    const block = isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64 } };
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }],
    });
    const text = (response.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    const cleaned = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    const r = JSON.parse(cleaned);
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return NextResponse.json({
      result: {
        supplier: String(r.supplier || "").slice(0, 80),
        invoiceNumber: String(r.invoiceNumber || "").slice(0, 40),
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) ? r.date : "",
        deliveryAddress: String(r.deliveryAddress || "").slice(0, 160),
        deliveryIncGst: num(r.deliveryIncGst),
        lines: (Array.isArray(r.lines) ? r.lines : []).slice(0, 60).map((l) => ({ desc: String(l.desc || "").slice(0, 120), qty: num(l.qty), totalIncGst: num(l.totalIncGst) })),
        totalIncGst: num(r.totalIncGst),
        isOrderOnly: !!r.isOrderOnly,
      },
    });
  } catch (e) {
    console.error("read-invoice failed", e);
    return NextResponse.json({ error: "Couldn't read that invoice. Try a clearer photo, or a PDF." }, { status: 500 });
  }
}
