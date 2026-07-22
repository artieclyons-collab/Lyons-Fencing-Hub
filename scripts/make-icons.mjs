// One-off: renders the "LF" brand tile to PNG icons for the home screen / PWA.
// Requires a local Chrome/Edge (same detection as the PDF route).
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const candidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const executablePath = candidates.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error("No Chrome/Edge found — set CHROME_PATH");
  process.exit(1);
}

const html = (size) => `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700&display=swap" rel="stylesheet">
<style>
  body{margin:0}
  .tile{width:${size}px;height:${size}px;background:#E8B923;display:flex;align-items:center;justify-content:center;
    font-family:'Barlow Condensed',Arial,sans-serif;font-weight:700;color:#1C1F1D;font-size:${Math.round(size * 0.42)}px;letter-spacing:${Math.round(size * 0.01)}px;}
</style></head><body><div class="tile">LF</div></body></html>`;

const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
for (const [size, name] of [[512, "icon-512.png"], [192, "icon-192.png"], [180, "apple-touch-icon.png"]]) {
  await page.setViewport({ width: size, height: size });
  await page.setContent(html(size), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `public/${name}`, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`public/${name}`);
}
await browser.close();
