// Renders a quote/invoice to a PDF (server-only). Shared by the download button (/api/pdf) and by emailing a document.
// On Vercel it uses @sparticuz/chromium (a Chromium build packaged for serverless); locally it drives an installed
// Chrome/Edge — set CHROME_PATH to override.
import fs from "node:fs";
import { buildStandaloneHtml } from "./docHtml";
import { buildFilename } from "./logic";

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
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const executablePath = candidates.find((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
  if (!executablePath) throw new Error("No Chrome/Edge found for local PDF rendering — set CHROME_PATH in .env.local");
  return puppeteer.launch({ executablePath, headless: true });
}

// -> { pdf: Buffer, filename: "Quote Paul Palm Beach Colorbond fence.pdf" }
export async function renderPdf(type, data) {
  let browser;
  try {
    const html = buildStandaloneHtml(type, data);
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    // Wait for the Google Fonts to finish loading so the PDF uses Barlow, not the fallback.
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
    return { pdf: Buffer.from(pdf), filename: `${buildFilename(type, data)}.pdf` };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
