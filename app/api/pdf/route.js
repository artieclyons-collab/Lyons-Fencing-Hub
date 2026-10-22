import { NextResponse } from "next/server";
import { renderPdf } from "@/lib/pdf";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { type, data } = await req.json();
    if (!type || !data) return NextResponse.json({ error: "type and data are required" }, { status: 400 });
    const { pdf, filename } = await renderPdf(type, data);
    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7E]/g, "")}"`,
      },
    });
  } catch (e) {
    console.error("PDF generation failed", e);
    return NextResponse.json({ error: e.message || "PDF generation failed" }, { status: 500 });
  }
}
