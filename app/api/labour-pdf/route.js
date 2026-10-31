// The labourer's invoice as a PDF from a link: /api/labour-pdf?d=<encoded invoice> (see encodeLabour in lib/labourInvoice.js).
// The hub texts this link to him; he opens it, saves the PDF and emails it back. Nothing is stored — the link holds the invoice.
import { NextResponse } from "next/server";
import { renderPdf } from "@/lib/pdf";
import { decodeLabour } from "@/lib/labourInvoice";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req) {
  const data = decodeLabour(new URL(req.url).searchParams.get("d") || "");
  if (!data) return new NextResponse("This invoice link isn't valid.", { status: 400 });
  try {
    const { pdf, filename } = await renderPdf("labour", data);
    return new NextResponse(pdf, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename.replace(/[^\x20-\x7E]/g, "")}"` },
    });
  } catch (e) {
    console.error("Labour PDF failed", e);
    return new NextResponse("Couldn't make the invoice PDF — try the link again.", { status: 500 });
  }
}
