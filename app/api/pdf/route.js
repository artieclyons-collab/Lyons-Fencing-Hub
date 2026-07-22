import { NextResponse } from "next/server";
import { buildStandaloneHtml } from "@/lib/docHtml";
import { buildFilename } from "@/lib/logic";
import fs from "fs";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// On Vercel we use @sparticuz/chromium (a Chromium build packaged for serverless).
// Locally we drive an installed Chrome/Edge instead — set CHROME_PATH to override.
async function getBrowser() {
  const puppeteer = (await import("puppeteer-core")).default;
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

  if (isServerless) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const executablePath = candidates.find((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
  if (!executablePath) {
    throw new Error("No Chrome/Edge found for local PDF rendering — set CHROME_PATH in .env.local");
  }
  return puppeteer.launch({ executablePath, headless: true });
}

export async function POST(req) {
  let browser;
  try {
    const { type, data } = await req.json();
    if (!type || !data) return NextResponse.json({ error: "type and data are required" }, { status: 400 });

    const html = buildStandaloneHtml(type, data);
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    // Wait for the Google Fonts to finish loading so the PDF uses Barlow, not the fallback.
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    const filename = `${buildFilename(type, data)}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7E]/g, "")}"`,
      },
    });
  } catch (e) {
    console.error("PDF generation failed", e);
    return NextResponse.json({ error: e.message || "PDF generation failed" }, { status: 500 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
