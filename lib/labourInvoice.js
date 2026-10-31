// Sub-contractor (labourer) invoice: the labourer bills Lyons Fencing & Services for the hours worked.
// Pure functions only, so the screen, the on-screen preview and the server-side PDF all agree on the numbers.
import { BIZ } from "./constants";
import { money } from "./logic";

export const LABOURER = {
  name: "Usher Jai Oakenfull",
  short: "Usher Oakenfull",
  abn: "21388972919",
  rate: 35,
  lunchMin: 30, // unpaid, taken off every day (Saturdays too); never shown on the invoice
  phone: "0451961962",
  bank: { accountName: "Usher Jai Oakenfull", bsb: "067872", accountNumber: "46068576" },
};

export const PAYER = {
  name: "Artie Campbell Lyons",
  business: BIZ.name,
  abn: BIZ.abn,
};

export const fmtAbn = (abn) => {
  const d = String(abn || "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : String(abn || "");
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const fmtHours = (h) => String(round2(h));

// "8", "8.5", "7:30" (= 7h30m) or a start–finish like "7-3:30", "6:30am-3pm" -> hours on site (before lunch), or null.
export function parseHours(text) {
  const t = String(text ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^\d+:\d{2}$/.test(t) && !/[-–]/.test(t)) {
    const [h, m] = t.split(":").map(Number);
    return m < 60 ? round2(h + m / 60) : null;
  }
  const range = t.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)?(?:-|–|to)(\d{1,2})(?::?(\d{2}))?(am|pm)?$/);
  if (!range) return null;
  const clock = (h, m, ap) => {
    let hh = Number(h);
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    return hh * 60 + Number(m || 0);
  };
  const start = clock(range[1], range[2], range[3]);
  let end = clock(range[4], range[5], range[6]);
  while (end <= start) end += 12 * 60; // "7-3:30" means 7am to 3:30pm
  return round2((end - start) / 60);
}

export const paidHours = (worked, lunchMin) => Math.max(0, round2(Number(worked || 0) - Number(lunchMin || 0) / 60));

// -> { rows: [{date, address, worked, paid, amount}], totalHours, total }
export function labourTotals(data) {
  const rate = Number(data.rate) || 0;
  const rows = (data.days || [])
    .map((d) => {
      const worked = typeof d.hours === "number" ? d.hours : parseHours(d.hours);
      if (worked == null || !d.date) return null;
      const paid = paidHours(worked, data.lunchMin);
      return { date: d.date, address: String(d.address || "").trim(), worked, paid, amount: round2(paid * rate) };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { rows, totalHours: round2(rows.reduce((s, r) => s + r.paid, 0)), total: round2(rows.reduce((s, r) => s + r.amount, 0)) };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayLabel(iso, withYear = false) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y || !m || !d) return iso || "";
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${wd} ${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}
export const longDate = (iso) => {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso || "";
};

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const LABOUR_CSS = `
.lab-head{ display:flex; justify-content:space-between; align-items:flex-end; padding:30px 44px 0; }
.lab-name{ font-family:'Barlow Condensed',Arial,sans-serif; font-size:26px; font-weight:700; letter-spacing:0.4px; line-height:1.1; color:#232323; }
.lab-sub{ font-size:11.5px; color:#5b5b5b; margin-top:4px; letter-spacing:0.2px; }
.lab-ref{ text-align:right; }
.lab-ref .doc-title{ margin:0; font-size:34px; }
.lab-ref-num{ font-size:12px; color:#8a8a8a; margin-top:2px; letter-spacing:0.4px; }
.lab-table{ width:calc(100% - 88px); margin:0 44px; border-collapse:collapse; font-size:12.5px; }
.lab-table thead th{ text-align:left; background:#232323; color:#fff; padding:9px 10px; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.4px; }
.lab-table td{ border-bottom:1px solid #e6e6e3; padding:10px; vertical-align:top; }
.lab-table tbody tr:nth-child(even){ background:#FAFAF8; }
.lab-table .num{ text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.lab-table .date{ white-space:nowrap; font-weight:600; }
.lab-table .calc{ display:block; color:#8a8a8a; font-size:11px; margin-top:1px; }
.lab-lower{ margin:0 44px 24px; }
.lab-pay-empty{ color:#B0623A; }
`;

// The document body (the .doc-page div) for type "labour".
export function buildLabourHtml(data) {
  const { rows, totalHours, total } = labourTotals(data);
  const rate = Number(data.rate) || 0;
  const bank = data.bank || {};
  const hasBank = bank.accountName || bank.bsb || bank.accountNumber;
  const noteLines = String(data.notes || "").split("\n").map((n) => n.trim()).filter(Boolean);
  const first = rows[0]?.date;
  const last = rows[rows.length - 1]?.date;
  const period = first ? (first === last ? longDate(first) : `${longDate(first)} – ${longDate(last)}`) : "";

  const body = rows.length === 0
    ? `<tr><td colspan="5" style="text-align:center;color:#999;padding:20px">No days added yet</td></tr>`
    : rows.map((r) => `
      <tr>
        <td class="date">${esc(dayLabel(r.date))}</td>
        <td>${esc(r.address || "Fencing labour")}</td>
        <td class="num">${esc(fmtHours(r.paid))}</td>
        <td class="num">${esc(money(rate))}</td>
        <td class="num">${esc(money(r.amount))}</td>
      </tr>`).join("");

  return `
<div class="doc-page">
  <div class="doc-topbar"></div>
  <header class="lab-head">
    <div>
      <div class="lab-name">${esc(LABOURER.name)}</div>
      <div class="lab-sub">ABN ${esc(fmtAbn(LABOURER.abn))}</div>
    </div>
    <div class="lab-ref">
      <h1 class="doc-title">Invoice</h1>
      <div class="lab-ref-num">No. ${esc(data.number || "—")}</div>
    </div>
  </header>
  <div class="doc-divider"></div>

  <div class="doc-info-grid" style="margin-top:22px">
    <div class="doc-info-box">
      <div class="doc-info-label">Bill to</div>
      <div class="doc-info-name">${esc(PAYER.name)}</div>
      <div class="doc-info-line">${esc(PAYER.business)}</div>
      <div class="doc-info-line">ABN ${esc(fmtAbn(PAYER.abn))}</div>
    </div>
    <div class="doc-info-box">
      <div class="doc-info-label">Invoice details</div>
      <div class="doc-info-row"><span>Invoice number</span><strong>${esc(data.number || "—")}</strong></div>
      <div class="doc-info-row"><span>Date issued</span><strong>${esc(longDate(data.date))}</strong></div>
      ${period ? `<div class="doc-info-row"><span>Work period</span><strong>${esc(period)}</strong></div>` : ""}
    </div>
  </div>

  <h2 class="doc-h3">Labour</h2>
  <table class="lab-table">
    <thead><tr><th>Date</th><th>Description</th><th class="num">Total hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>${body}</tbody>
  </table>

  <div class="doc-totals">
    <div class="doc-totals-row"><span>Total hours</span><span>${esc(fmtHours(totalHours))}</span></div>
    <div class="doc-totals-row doc-total-grand"><span>Total due</span><span>${esc(money(total))}</span></div>
  </div>

  ${noteLines.length > 0 ? `
  <div class="lab-lower" style="margin-top:20px">
    <h3 class="doc-h4">Notes</h3>
    <ul class="doc-list">${noteLines.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
  </div>` : `<div style="height:14px"></div>`}

  <div class="doc-payment-box">
    <div>
      <h3 class="doc-h4">Payment details</h3>
      <p class="doc-p">Hourly rate: ${esc(money(rate))}</p>
    </div>
    <div>
      <h3 class="doc-h4">Bank details for direct deposit</h3>
      ${hasBank
        ? `<p class="doc-p">Account name: ${esc(bank.accountName || LABOURER.name)}<br />BSB: ${esc(bank.bsb || "—")}<br />Account number: ${esc(bank.accountNumber || "—")}<br />Reference: Invoice ${esc(data.number || "")}</p>`
        : `<p class="doc-p lab-pay-empty">Add the bank details before sending.</p>`}
    </div>
  </div>

  <div class="doc-footer">
    <strong>${esc(LABOURER.name)}</strong>
    <span>ABN ${esc(fmtAbn(LABOURER.abn))}</span>
  </div>
</div>`;
}

// ---- the invoice as a link (texted to the labourer, who opens the PDF, saves it and emails it back) ----
const b64 = (str) => {
  let bin = "";
  for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64 = (s) => {
  const bin = atob(String(s).replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

// Only what differs from the usual (rate, lunch, bank) is put in the link, so it stays short.
export function encodeLabour(data) {
  const { rows } = labourTotals(data);
  const bank = data.bank || {};
  const o = { n: data.number, d: data.date, y: rows.map((r) => [r.date, r.worked, r.address]) };
  if (Number(data.rate) !== LABOURER.rate) o.r = Number(data.rate);
  if (Number(data.lunchMin) !== LABOURER.lunchMin) o.l = Number(data.lunchMin);
  if (["accountName", "bsb", "accountNumber"].some((k) => (bank[k] || "") !== LABOURER.bank[k])) o.b = [bank.accountName || "", bank.bsb || "", bank.accountNumber || ""];
  if (data.notes) o.x = data.notes;
  return b64(JSON.stringify(o));
}

// Reads a link back into invoice data, or null if it isn't one. Everything is clamped, since anyone can open the link.
export function decodeLabour(text) {
  let o;
  try { o = JSON.parse(unb64(text)); } catch { return null; }
  if (!o || !Array.isArray(o.y) || o.y.length === 0 || o.y.length > 62) return null;
  const str = (v, n) => String(v ?? "").slice(0, n);
  const num = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : dflt);
  const days = o.y
    .filter((r) => Array.isArray(r) && /^\d{4}-\d{2}-\d{2}$/.test(String(r[0])) && Number(r[1]) > 0 && Number(r[1]) <= 24)
    .map((r) => ({ date: String(r[0]), hours: Number(r[1]), address: str(r[2], 120) }));
  if (days.length === 0) return null;
  const b = Array.isArray(o.b) ? o.b : [];
  return {
    number: str(o.n, 10),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.d)) ? String(o.d) : days[0].date,
    rate: num(o.r, 0, 500, LABOURER.rate),
    lunchMin: num(o.l, 0, 240, LABOURER.lunchMin),
    bank: Array.isArray(o.b) ? { accountName: str(b[0], 60), bsb: str(b[1], 12), accountNumber: str(b[2], 20) } : { ...LABOURER.bank },
    notes: str(o.x, 300),
    days,
  };
}
