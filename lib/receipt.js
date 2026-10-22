// Works out an expense from the text read off a receipt photo (fuel and the tip, mostly). Pure text in, guess out —
// always shown to the person to check, never saved on its own. Amounts are the GST-inclusive total on the receipt.

const MONEY = /(?:\$\s*)?(\d{1,4})\s*[.,]\s*(\d{2})(?!\d)/g;

// Every money-looking amount on a line, as numbers. OCR often reads "." as "," or puts a space in ("104 04").
function amountsIn(line) {
  const out = [];
  let m;
  MONEY.lastIndex = 0;
  while ((m = MONEY.exec(line))) out.push(Number(`${m[1]}.${m[2]}`));
  return out;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");

// An ISO date (YYYY-MM-DD) from the first date on the receipt, or null. Australian day-first order.
export function findDate(text, now = new Date()) {
  const y2 = (y) => (y < 100 ? 2000 + y : y);
  const ok = (d, m, y) => d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= now.getFullYear() - 2 && y <= now.getFullYear() + 1;
  let m = /\b(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})\b/.exec(text);
  if (m && ok(Number(m[1]), Number(m[2]), y2(Number(m[3])))) return `${y2(Number(m[3]))}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  m = /\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s*(\d{4}|\d{2})\b/i.exec(text);
  if (m && ok(Number(m[1]), MONTHS[m[2].toLowerCase()], y2(Number(m[3])))) return `${y2(Number(m[3]))}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(Number(m[1]))}`;
  return null;
}

const FUEL = /diesel|unleaded|\bulp\b|\bpulp\b|premium|\bp9[158]\b|\bu9[158]\b|e10|petrol|fuel|ampol|caltex|\bbp\b|shell|7[- ]?eleven|united|puma|liberty|metro petroleum|costco|pump\s*\d|\blitres?\b|\bltrs?\b/i;
const TIP = /\btip\b|waste|landfill|transfer station|weighbridge|recycl|tonn?es?|green waste|refuse|council|disposal|\bgate fee\b/i;

// The total: prefer a line that says so, otherwise the biggest amount on the receipt.
function findTotal(lines) {
  const keyed = [];
  for (const l of lines) {
    if (/\b(total|amount|eftpos|visa|mastercard|debit|credit|paid|balance due|sale|due)\b/i.test(l) && !/\b(gst|tax|saving|discount|change|cash back|points|per litre|c\/l|cpl)\b/i.test(l)) {
      keyed.push(...amountsIn(l));
    }
  }
  const pool = keyed.length ? keyed : lines.flatMap(amountsIn);
  const sane = pool.filter((n) => n > 0 && n < 5000);
  if (!sane.length) return null;
  // Of the candidates, the total is the one that appears most, then the largest (a receipt repeats its total on the card line).
  const counts = new Map();
  for (const n of sane) counts.set(n, (counts.get(n) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

const BRANDS = ["Ampol", "Caltex", "BP", "Shell", "7-Eleven", "United", "Puma", "Liberty", "Metro", "Costco"];

// text: what the OCR read. -> { amount, date, category, description, confidence: "good"|"check", notes[] }
export function parseReceipt(text, now = new Date()) {
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const amount = findTotal(lines);
  const date = findDate(raw, now);
  const fuel = FUEL.test(raw);
  const tip = TIP.test(raw);
  // A fuel receipt wins over a tip receipt unless it names the tip clearly (a servo near a tip mentions neither).
  const category = tip && !(fuel && /diesel|unleaded|ulp|litre|pump/i.test(raw)) ? "Tipping/waste" : fuel ? "Fuel" : "Other";

  let description = "";
  if (category === "Fuel") {
    const brand = BRANDS.find((b) => new RegExp(`\\b${b.replace(/[-]/g, "[- ]?")}\\b`, "i").test(raw));
    const litres = /(\d{1,3}[.,]\d{2,3})\s*(?:l\b|ltrs?\b|litres?\b)/i.exec(raw) || /(?:litres?|volume|qty)\D{0,6}(\d{1,3}[.,]\d{2,3})/i.exec(raw);
    const grade = /diesel/i.test(raw) ? "diesel" : /unleaded|ulp|e10|u9\d/i.test(raw) ? "unleaded" : "";
    description = ["Fuel", brand || grade ? "—" : "", brand, grade, litres ? `${litres[1].replace(",", ".")}L` : ""].filter(Boolean).join(" ");
  } else if (category === "Tipping/waste") {
    const place = lines.find((l) => /waste|landfill|transfer|recycl|council|tip/i.test(l) && l.length < 50);
    description = `Tip${place ? ` — ${place.replace(/^[^A-Za-z]+/, "")}` : ""}`;
  } else {
    description = lines.find((l) => /[A-Za-z]{3,}/.test(l) && l.length < 40) || "";
  }

  const notes = [];
  if (amount == null) notes.push("I couldn't find the total — type it in.");
  if (!date) notes.push("I couldn't find the date, so it's set to today.");
  return { amount, date, category, description, confidence: amount != null && date ? "good" : "check", notes };
}
