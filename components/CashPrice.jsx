"use client";
// "Apply cash price" on a quote: when the client says yes to the cash price, this takes it off as a "Cash payment discount" line so the quote
// (and the invoices made from it) total exactly the cash price. It uses the price that was emailed if there is one, otherwise ~10% off rounded
// down to $50, and the amount can be changed before applying. Nothing is saved until the quote is saved. (lib/cashPrice.js)
import { useState } from "react";
import { Banknote, Check, X } from "lucide-react";
import { money } from "@/lib/logic";
import { cashPriceOf, cashOffers, applyCashPrice, hasCashLine, quoteTotalInc, CASH_LINE, sensibleCashPrice } from "@/lib/cashPrice";

export default function CashPrice({ form, setItems }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [offered, setOffered] = useState(false);
  const has = hasCashLine(form.items);
  // the total before any cash discount, so applying twice (or changing the amount) never stacks
  const base = quoteTotalInc({ items: (form.items || []).filter((i) => String(i.desc || "").trim().toLowerCase() !== CASH_LINE.toLowerCase()) });
  if (!form.id || !(base > 0)) return null;

  const start = async () => {
    let p = 0;
    try {
      const rows = await fetch("/api/data/expenses", { cache: "no-store" }).then((r) => r.json()).then((j) => j.rows || []);
      p = cashOffers(rows)[form.id] || 0;
    } catch {}
    setOffered(!!p);
    setPrice(String(p || cashPriceOf(base)));
    setOpen(true);
  };
  const ok = sensibleCashPrice(base, Number(price));

  if (has && !open) {
    return (
      <button type="button" className="btn-ghost" onClick={() => setItems((items) => items.filter((i) => String(i.desc || "").trim().toLowerCase() !== CASH_LINE.toLowerCase()))} title="Takes the cash discount line off again (save the quote to keep it)">
        <Banknote size={15} /> Remove cash price
      </button>
    );
  }
  if (!open) {
    return <button type="button" className="btn-ghost" onClick={start} title="They've agreed to the cash price: takes it off as a discount line"><Banknote size={15} /> Apply cash price</button>;
  }
  return (
    <span className="check-row" style={{ gap: 6, alignItems: "center" }}>
      <span className="calc-note" style={{ margin: 0 }}>{offered ? "Emailed cash price" : "Cash price"} (was {money(base)}) inc. GST $</span>
      <input className="li-num" type="number" step="50" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 90 }} />
      <button type="button" className="btn-primary" disabled={!ok} onClick={() => { setItems((items) => applyCashPrice(items, Number(price))); setOpen(false); }}><Check size={14} /> Apply</button>
      <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Cancel"><X size={14} /></button>
    </span>
  );
}
