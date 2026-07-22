// Branded quote/invoice document, rendered as an HTML string.
// One renderer serves both the on-screen preview (via dangerouslySetInnerHTML)
// and the server-side PDF route, so what you preview is exactly what prints.
import { BIZ, STANDARD_TERMS, UNDERGROUND_DISCLAIMER } from "./constants";
import { itemsTotal, formatQty, money, addMonths, formatDateAU, today } from "./logic";
import { LOGO_DATA_URI } from "./logo";

export const DOC_CSS = `
.doc-page{
  color:#232323; line-height:1.55;
  font-family:'Barlow',Arial,Helvetica,sans-serif; font-size:13px;
  background:#fff;
}
.doc-page h1, .doc-page h2, .doc-page h3{ font-family:'Barlow Condensed',Arial,sans-serif; }

.doc-topbar{ height:6px; background:linear-gradient(90deg,#232323 0%,#232323 82%,#B08D57 82%,#B08D57 100%); }

.doc-header{ display:flex; justify-content:space-between; align-items:flex-start; padding:26px 44px 0; }
.doc-logo{ height:38px; }
.doc-header-contact{ text-align:right; font-size:11.5px; color:#5b5b5b; line-height:1.7; letter-spacing:0.2px; }

.doc-divider{ height:1px; background:#e6e6e3; margin:20px 44px 0; }

.doc-title{ font-size:30px; font-weight:600; letter-spacing:1px; margin:24px 44px 20px; text-transform:uppercase; color:#3a3a3a; }

.doc-info-grid{ display:flex; gap:0; margin:0 44px 28px; background:#F7F5F1; border-radius:6px; overflow:hidden; }
.doc-info-box{ flex:1; padding:16px 20px; font-size:12.5px; min-width:0; }
.doc-info-box + .doc-info-box{ border-left:1px solid #e9e5dc; }
.doc-info-label{ font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:#B08D57; margin-bottom:8px; }
.doc-info-name{ font-size:16px; font-weight:700; margin-bottom:2px; }
.doc-info-line{ color:#4a4a4a; }
.doc-info-row{ display:flex; justify-content:space-between; gap:12px; font-size:12px; padding:2px 0; }
.doc-info-row span{ color:#8a8a8a; }
.doc-info-row strong{ color:#232323; font-weight:600; }

.doc-h3{ font-size:14px; font-weight:700; text-transform:uppercase; letter-spacing:0.6px; margin:0 44px 10px; padding-bottom:8px; border-bottom:2px solid #232323; }
.doc-h4{ font-size:12.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; margin:0 0 8px; color:#232323; }
.doc-p{ margin:0; font-size:12px; color:#4a4a4a; }

.doc-table{ width:calc(100% - 88px); margin:0 44px; border-collapse:collapse; font-size:12.5px; }
.doc-table thead th{ text-align:left; background:#232323; color:#fff; padding:9px 10px; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.4px; }
.doc-table td{ border-bottom:1px solid #e6e6e3; padding:10px; vertical-align:top; }
.doc-table td:first-child strong{ display:block; margin-bottom:2px; }
.doc-table tbody tr:nth-child(even){ background:#FAFAF8; }
.doc-table th:not(:first-child), .doc-table td:not(:first-child){ text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.doc-empty-row{ text-align:center !important; color:#999; padding:20px !important; }

.doc-totals{ max-width:300px; margin:10px 44px 0 auto; font-size:12.5px; }
.doc-totals-row{ display:flex; justify-content:space-between; padding:5px 2px; color:#4a4a4a; }
.doc-total-grand{
  border-top:2px solid #232323; margin-top:4px; padding-top:10px !important;
  font-weight:700; font-size:16px; color:#232323;
}
.doc-total-deposit{ background:#F7F5F1; border-left:4px solid #B08D57; border-radius:0 5px 5px 0; padding:8px 10px !important; font-weight:700; color:#232323; margin-top:8px; }

.doc-lower{ margin:0 44px 24px; }
.doc-col + .doc-col{ margin-top:20px; }
.doc-list{ margin:0; padding-left:16px; font-size:12px; color:#4a4a4a; }
.doc-list li{ margin-bottom:12px; }
.doc-list li:last-child{ margin-bottom:0; }
.doc-list-small{ font-size:11px; line-height:1.6; }

.doc-payment-box{
  display:flex; gap:32px; background:#F7F5F1; border-radius:6px; padding:18px 20px; margin:0 44px 24px;
}
.doc-payment-box > div{ flex:1; }

.doc-acceptance{ margin:0 44px 24px; }
.doc-sig-row{ display:flex; gap:40px; margin-top:34px; }
.doc-sig-line{ flex:1; border-top:1px solid #232323; padding-top:6px; font-size:11px; color:#8a8a8a; }

.doc-disclaimer{ font-size:10.5px; color:#8a8a8a; margin:0 44px 20px; border-top:1px solid #e6e6e3; padding-top:14px; line-height:1.6; }

.doc-footer{
  background:#232323; color:#fff; padding:14px 44px; display:flex; justify-content:space-between;
  align-items:center; font-size:11px; flex-wrap:wrap; gap:6px;
}
.doc-footer strong{ letter-spacing:0.3px; }
.doc-footer span{ color:#c9c9c9; }
`;

// Extra rules only for the standalone/printed document, not injected into the app page.
export const DOC_PRINT_CSS = `
body{ margin:0; background:#fff; }
* { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
@page{ margin:0; }
`;

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Returns the inner document markup (the .doc-page div).
export function buildDocumentHtml(type, data) {
  const isQuote = type === "quote";
  const subtotal = itemsTotal(data.items);
  const gst = subtotal * 0.1;
  const grandTotal = subtotal + gst;
  const depositPct = Number(data.depositPercent) || 10;
  const deposit = grandTotal * (depositPct / 100);
  const dateStr = data.date || data.issuedDate || today();
  const validUntilStr = isQuote ? addMonths(dateStr, 3) : null;
  const noteLines = (data.notes || "").split("\n").map((n) => n.trim()).filter(Boolean);
  const items = data.items || [];

  const rows = items.length === 0
    ? `<tr><td colspan="4" class="doc-empty-row">No line items yet</td></tr>`
    : items.map((it) => `
      <tr>
        <td>${esc(it.desc)}</td>
        <td>${esc(formatQty(it.qty, it.unit))}</td>
        <td>${esc(money(it.rate))}</td>
        <td>${esc(money(Number(it.qty || 0) * Number(it.rate || 0)))}</td>
      </tr>`).join("");

  return `
<div class="doc-page">
  <div class="doc-topbar"></div>
  <header class="doc-header">
    <img src="${LOGO_DATA_URI}" alt="${esc(BIZ.name)}" class="doc-logo" />
    <div class="doc-header-contact">
      <div>${esc(BIZ.phone)}</div>
      <div>${esc(BIZ.email)}</div>
    </div>
  </header>
  <div class="doc-divider"></div>

  <h1 class="doc-title">${isQuote ? "Quote" : "Tax Invoice"}</h1>

  <div class="doc-info-grid">
    <div class="doc-info-box">
      <div class="doc-info-label">Client</div>
      <div class="doc-info-name">${esc(data.clientName || "—")}</div>
      ${(data.address || data.suburb) ? `<div class="doc-info-line">${esc([data.address, data.suburb].filter(Boolean).join(", "))}</div>` : ""}
    </div>
    <div class="doc-info-box">
      <div class="doc-info-label">${isQuote ? "Quote" : "Invoice"} details</div>
      <div class="doc-info-row"><span>${isQuote ? "Quote" : "Invoice"} number</span><strong>${esc(data.docNumber || "—")}</strong></div>
      <div class="doc-info-row"><span>Date issued</span><strong>${esc(formatDateAU(dateStr))}</strong></div>
      ${isQuote && validUntilStr ? `<div class="doc-info-row"><span>Valid until</span><strong>${esc(formatDateAU(validUntilStr))}</strong></div>` : ""}
      ${!isQuote && data.dueDate ? `<div class="doc-info-row"><span>Due</span><strong>${esc(formatDateAU(data.dueDate))}</strong></div>` : ""}
      <div class="doc-info-row"><span>ABN</span><strong>${esc(BIZ.abn)}</strong></div>
    </div>
  </div>

  <h2 class="doc-h3">${isQuote ? "Scope of works" : "Summary of works"}</h2>
  <table class="doc-table">
    <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="doc-totals">
    <div class="doc-totals-row"><span>Subtotal</span><span>${esc(money(subtotal))}</span></div>
    <div class="doc-totals-row"><span>GST (10%)</span><span>${esc(money(gst))}</span></div>
    <div class="doc-totals-row doc-total-grand"><span>Total (inc. GST)</span><span>${esc(money(grandTotal))}</span></div>
    ${isQuote ? `<div class="doc-totals-row doc-total-deposit"><span>Deposit due (${depositPct}%)</span><span>${esc(money(deposit))}</span></div>` : ""}
  </div>

  <div class="doc-lower">
    ${noteLines.length > 0 ? `
    <div class="doc-col">
      <h3 class="doc-h4">Notes</h3>
      <ul class="doc-list">${noteLines.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
    </div>` : ""}
    ${isQuote ? `
    <div class="doc-col">
      <h3 class="doc-h4">Terms and conditions</h3>
      <ul class="doc-list doc-list-small">${STANDARD_TERMS.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </div>` : ""}
  </div>

  <div class="doc-payment-box">
    <div>
      <h3 class="doc-h4">Payment terms</h3>
      ${isQuote
        ? `<p class="doc-p">Deposit: ${depositPct}% upfront, prior to commencement.<br />Balance: due within 14 days of completion.</p>`
        : `<p class="doc-p">Payment due within 14 days of completion.</p>`}
    </div>
    <div>
      <h3 class="doc-h4">${isQuote ? "Deposit details" : "Bank details for direct deposit"}</h3>
      <p class="doc-p">Account name: ${esc(BIZ.bankAccountName)}<br />BSB: ${esc(BIZ.bsb)}<br />Account number: ${esc(BIZ.accountNumber)}<br />Reference: ${esc(data.docNumber || "—")}</p>
    </div>
  </div>

  ${isQuote ? `
  <div class="doc-acceptance">
    <h3 class="doc-h4">Acceptance</h3>
    <p class="doc-p">To accept this quote, sign and return — or simply reply by email or text and we'll lock in a start date.</p>
    <div class="doc-sig-row">
      <div class="doc-sig-line">Signature / Name</div>
      <div class="doc-sig-line">Date</div>
    </div>
  </div>` : ""}

  <p class="doc-disclaimer"><strong>Underground services disclaimer:</strong> ${esc(UNDERGROUND_DISCLAIMER)}</p>

  <div class="doc-footer">
    <strong>${esc(BIZ.name)}</strong>
    <span>ABN ${esc(BIZ.abn)} · ${esc(BIZ.website)} · ${esc(BIZ.email)} · ${esc(BIZ.phone)}</span>
  </div>
</div>`;
}

// Quarterly BAS summary — a one-page report reusing the same document chrome
// as quotes/invoices (logo, table styles, footer) so it looks consistent.
// Field labels match the ATO's BAS form (G1, 1A, G11, 1B) for easy transcription.
export function buildBasHtml(data) {
  const { periodLabel, preparedDate, totalSalesIncGst, gstCollected, totalExpensesIncGst, gstCredits, netGst, byCategory } = data;
  const catRows = (byCategory || []).length === 0
    ? `<tr><td colspan="2" class="doc-empty-row">No expenses logged this period</td></tr>`
    : byCategory.map((c) => `<tr><td>${esc(c.category)}</td><td>${esc(money(c.total))}</td></tr>`).join("");

  return `
<div class="doc-page">
  <div class="doc-topbar"></div>
  <header class="doc-header">
    <img src="${LOGO_DATA_URI}" alt="${esc(BIZ.name)}" class="doc-logo" />
    <div class="doc-header-contact">
      <div>${esc(BIZ.phone)}</div>
      <div>${esc(BIZ.email)}</div>
    </div>
  </header>
  <div class="doc-divider"></div>

  <h1 class="doc-title">BAS Summary</h1>

  <div class="doc-info-grid">
    <div class="doc-info-box">
      <div class="doc-info-label">Period</div>
      <div class="doc-info-name">${esc(periodLabel)}</div>
    </div>
    <div class="doc-info-box">
      <div class="doc-info-label">Business</div>
      <div class="doc-info-row"><span>ABN</span><strong>${esc(BIZ.abn)}</strong></div>
      <div class="doc-info-row"><span>Prepared</span><strong>${esc(formatDateAU(preparedDate))}</strong></div>
    </div>
  </div>

  <h2 class="doc-h3">GST summary</h2>
  <table class="doc-table">
    <thead><tr><th>Item</th><th>Amount</th></tr></thead>
    <tbody>
      <tr><td>Total sales (inc. GST) — G1</td><td>${esc(money(totalSalesIncGst))}</td></tr>
      <tr><td>GST collected on sales — 1A</td><td>${esc(money(gstCollected))}</td></tr>
      <tr><td>Total expenses (inc. GST) — G11</td><td>${esc(money(totalExpensesIncGst))}</td></tr>
      <tr><td>GST credits on purchases — 1B</td><td>${esc(money(gstCredits))}</td></tr>
      <tr><td><strong>Net GST ${netGst >= 0 ? "payable" : "refund"}</strong></td><td><strong>${esc(money(Math.abs(netGst)))}</strong></td></tr>
    </tbody>
  </table>

  <h2 class="doc-h3">Expenses by category</h2>
  <table class="doc-table">
    <thead><tr><th>Category</th><th>Amount (inc. GST)</th></tr></thead>
    <tbody>${catRows}</tbody>
  </table>

  <p class="doc-disclaimer"><strong>Note:</strong> Figures assume logged expense amounts are GST-inclusive, as they'd appear on a receipt. This is a working summary to speed up BAS preparation — always confirm final figures with your bookkeeper or accountant before lodging.</p>

  <div class="doc-footer">
    <strong>${esc(BIZ.name)}</strong>
    <span>ABN ${esc(BIZ.abn)} · ${esc(BIZ.website)} · ${esc(BIZ.email)} · ${esc(BIZ.phone)}</span>
  </div>
</div>`;
}

// Full standalone HTML document (used by the PDF route).
export function buildStandaloneHtml(type, data) {
  const inner = type === "bas" ? buildBasHtml(data) : buildDocumentHtml(type, data);
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<title>${esc(BIZ.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>${DOC_CSS}${DOC_PRINT_CSS}</style>
</head><body>${inner}</body></html>`;
}
