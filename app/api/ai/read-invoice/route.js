// Reads a supplier invoice (a photo, screenshot or PDF: Our Town Fencing, Bunnings, anyone) with Claude and returns the parts the
// hub needs to put the real materials cost on a job. Nothing is saved here; the screen shows the result to check first.
// The reading itself is in lib/readInvoiceAi.js (shared with the email import).
import { NextResponse } from "next/server";
import { readInvoiceBase64 } from "@/lib/readInvoiceAi";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Reading invoices isn't set up: add an ANTHROPIC_API_KEY." }, { status: 501 });
  try {
    const { base64, mediaType } = await req.json();
    if (!base64) return NextResponse.json({ error: "A file is required" }, { status: 400 });
    return NextResponse.json({ result: await readInvoiceBase64({ base64, mediaType }) });
  } catch (e) {
    console.error("read-invoice failed", e);
    return NextResponse.json({ error: "Couldn't read that invoice. Try a clearer photo or the PDF." }, { status: 502 });
  }
}
