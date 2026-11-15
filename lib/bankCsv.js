// Reads a bank transactions export (CSV) into [{ date: "2026-11-15", description, amount }]: money in is positive, money out negative.
// Australian banks all export slightly differently: some have a header row (NAB, Westpac, Up), some have none (CommBank, ANZ, St George),
// some put money in and out in separate columns. This works out the columns from the data. Nothing leaves the browser.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");

export function parseDate(s) {
  const t = String(s || "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t); // day first (Australia)
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return Number(m[2]) <= 12 && Number(m[1]) <= 31 ? `${y}-${pad(m[2])}-${pad(m[1])}` : null; }
  m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{2,4})/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`; }
  return null;
}

export function parseAmount(s) {
  let t = String(s ?? "").trim();
  if (!t) return null;
  const cr = /\bCR\b/i.test(t), dr = /\bDR\b/i.test(t);
  t = t.replace(/\b(?:CR|DR)\b/gi, "").replace(/[$\s]/g, "");
  const paren = /^\(.*\)$/.test(t);
  t = t.replace(/[()]/g, "");
  if (!/^[+-]?[\d,]*\.?\d+$/.test(t)) return null;
  let n = Number(t.replace(/,/g, ""));
  if (paren || dr) n = -Math.abs(n);
  if (cr) n = Math.abs(n);
  return Number.isFinite(n) ? n : null;
}

// a CSV line splitter that understands quotes
function splitCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}

export function parseBankCsv(text) {
  const rows = splitCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((c) => String(c).trim().toLowerCase());
  const hasHeader = !rows[0].some((c) => parseDate(c)) && rows[0].some((c) => /date|amount|description|details|narrative|credit|debit|balance/i.test(c));
  const col = (re) => header.findIndex((h) => re.test(h));
  const idx = hasHeader
    ? { date: col(/date|time/), desc: col(/desc|detail|narrative|particular|reference|memo|payee/), amount: col(/^amount|^value|^transaction amount/), credit: col(/credit/), debit: col(/debit/) }
    : null;
  const out = [];
  for (const r of hasHeader ? rows.slice(1) : rows) {
    let date = null, amount = null, desc = "";
    if (idx && idx.date >= 0) {
      date = parseDate(r[idx.date]);
      if (idx.credit >= 0 || idx.debit >= 0) {
        const cr = parseAmount(r[idx.credit]), db = parseAmount(r[idx.debit]);
        amount = cr ? Math.abs(cr) : db ? -Math.abs(db) : null;
      } else if (idx.amount >= 0) amount = parseAmount(r[idx.amount]);
      desc = idx.desc >= 0 ? String(r[idx.desc] || "").trim() : "";
      if (idx.desc >= 0) {
        // some banks put the detail in several columns: add the other text cells
        const extra = r.filter((c, i) => i !== idx.desc && i !== idx.date && !parseDate(c) && parseAmount(c) == null && String(c).trim().length > 2).map((c) => String(c).trim());
        if (!desc && extra.length) desc = extra.join(" ");
      }
    }
    if (!date || amount == null) {
      // no usable header: the first date cell, the first number after it (the amount; the next one is the balance), the longest text
      const di = r.findIndex((c) => parseDate(c));
      if (di < 0) continue;
      date = parseDate(r[di]);
      const ai = r.findIndex((c, i) => i !== di && parseAmount(c) != null && !parseDate(c));
      if (ai < 0) continue;
      amount = parseAmount(r[ai]);
      desc = r.filter((c, i) => i !== di && i !== ai && parseAmount(c) == null && !parseDate(c)).sort((a, b) => String(b).length - String(a).length)[0] || "";
      desc = String(desc).trim();
    }
    if (date && amount != null && amount !== 0) out.push({ date, description: desc, amount: Math.round(amount * 100) / 100 });
  }
  return out;
}
