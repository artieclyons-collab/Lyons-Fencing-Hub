"use client";
// "Split in half": two neighbours share a fence and each pays their side. Asks for the neighbour's details, shows what each of you
// would pay, then the quote/invoice is halved and a copy is made for the neighbour (rules in lib/splitDoc.js).
import { useState } from "react";
import { X, Check } from "lucide-react";
import { money, itemsTotal, gstBreakdown } from "@/lib/logic";
import { halveItems } from "@/lib/splitDoc";

export default function SplitModal({ kind, doc, number, onClose, onConfirm }) {
  const [n, setN] = useState({ clientName: "", clientPhone: "", clientEmail: "", address: "", suburb: doc.suburb || "" });
  const set = (k, v) => setN((x) => ({ ...x, [k]: v }));
  const { mine, theirs } = halveItems(doc.items || []);
  const incl = (items) => gstBreakdown(itemsTotal(items)).total;
  const word = kind === "quote" ? "quote" : "invoice";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>Split this {word} in half</span><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
        <div className="modal-body">
          <p className="calc-note" style={{ marginTop: 0 }}>
            For a shared fence. Each line priced per metre is halved (the length), other lines are halved in price, and the neighbour gets a new {word} ({number}) for their half. Anything already taken off, like a deposit, stays on {doc.clientName || "the original"}'s.
          </p>
          <div className="calc-preview" style={{ marginBottom: 12 }}>
            <div className="calc-row"><span>{doc.clientName || "Original"} ({doc.docNumber || word})</span><span>{money(incl(mine))} inc. GST</span></div>
            <div className="calc-row"><span>Neighbour ({number})</span><span>{money(incl(theirs))} inc. GST</span></div>
          </div>
          <label className="field"><span>Neighbour's name</span><input value={n.clientName} onChange={(e) => set("clientName", e.target.value)} placeholder="e.g. Fiona Smith" autoFocus /></label>
          <label className="field"><span>Street address</span><input value={n.address} onChange={(e) => set("address", e.target.value)} placeholder="e.g. 25 Wedgebill Parade" /></label>
          <label className="field"><span>Suburb, state, postcode</span><input value={n.suburb} onChange={(e) => set("suburb", e.target.value)} /></label>
          <div className="field-pair">
            <label className="field"><span>Phone</span><input inputMode="tel" value={n.clientPhone} onChange={(e) => set("clientPhone", e.target.value)} /></label>
            <label className="field"><span>Email</span><input type="email" value={n.clientEmail} onChange={(e) => set("clientEmail", e.target.value)} /></label>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!n.clientName.trim()} onClick={() => onConfirm({ ...n, clientName: n.clientName.trim() })}><Check size={15} /> Split in half</button>
        </div>
      </div>
    </div>
  );
}
