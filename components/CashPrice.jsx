"use client";
// "Paying cash" on a quote: records that the client is paying this job in cash at the agreed price. The quote and the invoices that went to the
// client are NOT changed; the hub's own figures (income, owing, profit by job) use the cash price instead. It starts from the price that was
// emailed (else ~10% off, rounded down to $50) and the amount can be changed. (lib/cashPrice.js, lib/finances.js)
import { useEffect, useState } from "react";
import { Banknote, Check, X } from "lucide-react";
import { money } from "@/lib/logic";
import { cashPriceOf, cashOffers, cashDeals, quoteTotalInc, sensibleCashPrice, DEAL_PREFIX } from "@/lib/cashPrice";

async function rows() {
  return fetch("/api/data/expenses", { cache: "no-store" }).then((r) => r.json()).then((j) => j.rows || []);
}

export default function CashPrice({ form }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [offered, setOffered] = useState(false);
  const [deal, setDeal] = useState(0); // the agreed cash price already recorded for this quote
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const total = quoteTotalInc(form);

  useEffect(() => {
    let off = false;
    if (!form.id) return;
    rows().then((r) => { if (!off) setDeal(cashDeals(r)[form.id] || 0); }).catch(() => {});
    return () => { off = true; };
  }, [form.id]);

  if (!form.id || !(total > 0)) return null;

  const start = async () => {
    let p = 0;
    try { p = cashOffers(await rows())[form.id] || 0; } catch {}
    setOffered(!!p);
    setPrice(String(p || cashPriceOf(total)));
    setErr("");
    setOpen(true);
  };
  const save = async (value) => {
    setBusy(true); setErr("");
    try {
      const id = DEAL_PREFIX + form.id;
      if (value > 0) {
        const res = await fetch("/api/data/expenses", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: [{ id, category: "System", description: String(Math.round(value)), amount: "0", date: new Date().toISOString().slice(0, 10) }] }) });
        if (!res.ok) throw new Error("save failed");
      } else {
        const res = await fetch("/api/data/expenses", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }) });
        if (!res.ok) throw new Error("save failed");
      }
      setDeal(value > 0 ? Math.round(value) : 0);
      setOpen(false);
      window.dispatchEvent(new Event("hub-refresh"));
    } catch { setErr("Couldn't save that — nothing was changed."); }
    finally { setBusy(false); }
  };
  const ok = sensibleCashPrice(total, Number(price));

  if (open) {
    return (
      <span className="check-row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span className="calc-note" style={{ margin: 0 }}>{offered ? "Emailed cash price" : "Cash price"} (quote total {money(total)}) $</span>
        <input className="li-num" type="number" step="50" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 100 }} />
        <button type="button" className="btn-primary" disabled={!ok || busy} onClick={() => save(Number(price))}><Check size={14} /> {busy ? "Saving…" : "Paying cash"}</button>
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Cancel"><X size={14} /></button>
        <span className="calc-note" style={{ margin: 0, flexBasis: "100%" }}>The quote and invoices they're sent stay as they are. Only the hub's figures use the cash price.{err ? ` ${err}` : ""}</span>
      </span>
    );
  }
  if (deal > 0) {
    return (
      <span className="check-row" style={{ gap: 6, alignItems: "center" }}>
        <span className="calc-note" style={{ margin: 0 }}><Banknote size={13} style={{ verticalAlign: "-2px" }} /> Paying cash: {money(deal)}</span>
        <button type="button" className="btn-ghost small" onClick={start} disabled={busy}>Change</button>
        <button type="button" className="btn-ghost small" onClick={() => save(0)} disabled={busy}>Remove</button>
      </span>
    );
  }
  return <button type="button" className="btn-ghost" onClick={start} title="They're paying cash: the hub's figures use the cash price (the quote and invoices stay as they are)"><Banknote size={15} /> Paying cash</button>;
}
