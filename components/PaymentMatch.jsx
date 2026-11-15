"use client";
// "Match bank payments" on the Invoices tab: add your bank's transaction export (CSV, read in the browser) or screenshots of your transactions
// (read by Claude), and it lines up the money that came in with the invoices still unpaid. You tick the ones that are right and they're marked paid
// on the day the money arrived. Nothing changes until you confirm.
import { useMemo, useState } from "react";
import { X, Check, Upload } from "lucide-react";
import { money, today } from "@/lib/logic";
import { parseBankCsv } from "@/lib/bankCsv";
import { matchPayments } from "@/lib/paymentMatch";
import { itemsTotal, gstBreakdown } from "@/lib/logic";

const total = (i) => gstBreakdown(itemsTotal(i.items)).total;
const nice = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-AU", { day: "numeric", month: "short" }); };

function shrink(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ base64: c.toDataURL("image/jpeg", 0.85).split(",")[1], mediaType: "image/jpeg" });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't open that image.")); };
    img.src = url;
  });
}

export default function PaymentMatch({ invoices = [], setInvoices, onClose }) {
  const [txs, setTxs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState({}); // invoice id -> true (ticked)
  const [done, setDone] = useState(0);

  const result = useMemo(() => (txs ? matchPayments(txs, invoices) : null), [txs, invoices]);
  const unpaid = invoices.filter((i) => i.status !== "Paid");

  const load = async (files) => {
    setBusy(true); setError(""); setDone(0);
    try {
      const list = Array.from(files || []);
      let all = [];
      const images = [];
      for (const f of list) {
        if (/^image\//.test(f.type)) images.push(await shrink(f));
        else all = all.concat(parseBankCsv(await f.text()));
      }
      if (images.length) {
        const res = await fetch("/api/ai/read-bank", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images, today: today() }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Couldn't read the screenshots.");
        all = all.concat(body.transactions || []);
      }
      if (!all.length) throw new Error("I couldn't find any transactions in that. Try the CSV export from your bank, or a clearer screenshot.");
      setTxs(all);
      const m = matchPayments(all, invoices);
      setPicked(Object.fromEntries(m.matches.filter((x) => x.confidence !== "amount only").map((x) => [x.invoice.id, true])));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const apply = () => {
    const chosen = result.matches.filter((m) => picked[m.invoice.id]);
    if (!chosen.length) return;
    const byId = new Map(chosen.map((m) => [m.invoice.id, m.tx.date]));
    setInvoices((rows) => rows.map((i) => (byId.has(i.id) ? { ...i, status: "Paid", paidDate: byId.get(i.id) } : i)));
    setDone(chosen.length);
    setTxs(null);
  };
  const n = result ? result.matches.filter((m) => picked[m.invoice.id]).length : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>Match bank payments</span><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">
          {done > 0 && <p className="calc-note" style={{ color: "var(--good)" }}><Check size={13} style={{ verticalAlign: "-2px" }} /> Marked {done} {done === 1 ? "invoice" : "invoices"} paid.</p>}
          {!result && (
            <>
              <p className="calc-note" style={{ marginTop: 0 }}>
                {unpaid.length === 0 ? "There are no unpaid invoices to match." : <>You have {unpaid.length} unpaid {unpaid.length === 1 ? "invoice" : "invoices"} ({money(unpaid.reduce((s, i) => s + total(i), 0))}). Add your bank's transactions and I'll find which ones have been paid.</>}
              </p>
              <label className="btn-primary" style={{ cursor: "pointer", display: "inline-flex", gap: 6 }}>
                <Upload size={15} /> {busy ? "Reading…" : "Add a bank export or screenshots"}
                <input type="file" multiple accept=".csv,.txt,.tsv,text/csv,text/plain,image/*" hidden disabled={busy || unpaid.length === 0} onChange={(e) => { load(e.target.files); e.target.value = ""; }} />
              </label>
              <p className="calc-note">Best: the CSV export from your bank (internet banking, transactions, export, CSV). It's read right here in your browser and goes nowhere. A screenshot of your transactions works too: that one is sent to Claude to read, and only the transactions are used.</p>
              {error && <p className="calc-note" style={{ color: "var(--bad)" }}>{error}</p>}
            </>
          )}
          {result && (
            <>
              <p className="calc-note" style={{ marginTop: 0 }}>Read {txs.length} transactions ({txs.filter((t) => t.amount > 0).length} money in).</p>
              {result.matches.length === 0 && <p style={{ fontSize: 14 }}>No money in matched an unpaid invoice's exact amount.</p>}
              {result.matches.map((m) => (
                <label key={m.invoice.id} className="check-row" style={{ alignItems: "flex-start", padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                  <input type="checkbox" checked={!!picked[m.invoice.id]} onChange={(e) => setPicked((p) => ({ ...p, [m.invoice.id]: e.target.checked }))} />
                  <span style={{ fontSize: 14 }}>
                    <strong>{m.invoice.docNumber} {m.invoice.clientName}</strong> {money(m.tx.amount)} on {nice(m.tx.date)}
                    <span className="calc-note" style={{ display: "block", margin: 0, color: m.confidence === "amount only" ? "var(--warn, #c9873a)" : undefined }}>
                      {m.confidence === "sure" ? "Sure" : m.confidence === "likely" ? "Likely" : "Only the amount matches, check it's them"}: {m.why}. Bank says "{String(m.tx.description).slice(0, 60)}"
                    </span>
                  </span>
                </label>
              ))}
              {result.ambiguous.map((a, i) => (
                <p key={i} className="calc-note" style={{ color: "var(--warn, #c9873a)" }}>{money(a.tx.amount)} on {nice(a.tx.date)} could be {a.invoices.map((x) => `${x.docNumber} ${x.clientName}`).join(" or ")}. Mark the right one paid by hand.</p>
              ))}
              {result.unmatched.length > 0 && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", fontSize: 13 }}>{result.unmatched.length} other {result.unmatched.length === 1 ? "payment" : "payments"} in that didn't match an invoice</summary>
                  {result.unmatched.slice(0, 20).map((t, i) => <div key={i} className="calc-note" style={{ margin: "2px 0" }}>{nice(t.date)} · {money(t.amount)} · {String(t.description).slice(0, 60)}</div>)}
                </details>
              )}
            </>
          )}
        </div>
        <div className="modal-actions">
          {result && <button className="btn-ghost" onClick={() => setTxs(null)}>Start again</button>}
          {result && <button className="btn-primary" disabled={n === 0} onClick={apply}><Check size={15} /> Mark {n} paid</button>}
          {!result && <button className="btn-ghost" onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  );
}
