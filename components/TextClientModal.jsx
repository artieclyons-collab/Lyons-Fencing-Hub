"use client";
// "Text this client": a ready-written text (usually "I've just emailed you the quote") to the number saved on the quote, invoice or lead.
// A web page can't send an SMS by itself, so one tap opens it in Messages from your own number with the text filled in; you check it and press send.
import { useState } from "react";
import { Send, Copy, Check, X } from "lucide-react";
import { smsLink, firstName } from "@/lib/introText";

const SIGN = "Cheers, Artie";

// the wordings on offer for each kind of document
const presets = ({ kind, name, docNumber, total, deposit }) => {
  // (no "it's Artie from Lyons Fencing": the client already has your message history)
  const hi = `Hi ${name || ""},`.replace("Hi ,", "Hi,");
  const doc = docNumber ? ` (${docNumber})` : "";
  if (kind === "quote") {
    return [
      { label: "Just emailed the quote", text: `${hi} I've just emailed you the quote${doc}. Have a look when you get a chance, and let me know if you have any questions. If it's not in your inbox, check your junk folder. ${SIGN}` },
      { label: "Quote, nudge", text: `${hi} Just checking you got the quote${doc} I emailed through. Let me know if you have any questions or would like anything changed. ${SIGN}` },
    ];
  }
  if (kind === "invoice") {
    const what = deposit ? `the deposit invoice${docNumber ? ` ${docNumber}` : ""}` : `invoice${docNumber ? ` ${docNumber}` : ""}`;
    return [
      { label: "Just emailed the invoice", text: `${hi} I've just emailed you ${what}${total ? ` for ${total}` : ""}. The payment details are on it. Let me know if you have any questions. ${SIGN}` },
    ];
  }
  return [{ label: "Blank", text: `${hi} ` }];
};

export default function TextClientModal({ kind = "lead", name = "", phone = "", docNumber = "", total = "", deposit = false, onClose }) {
  const first = firstName(name);
  const options = presets({ kind, name: first, docNumber, total, deposit });
  const [body, setBody] = useState(options[0].text);
  const [number, setNumber] = useState(phone || "");
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const digits = String(number).replace(/\D/g, "");

  const open = () => {
    setOpened(true);
    window.location.href = smsLink(number, body);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard blocked */ }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>Text {name || "the client"}</span><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">
          {options.length > 1 && (
            <div className="calc-trigger-row" style={{ marginBottom: 8 }}>
              {options.map((o) => <button key={o.label} type="button" className="btn-ghost small" onClick={() => setBody(o.text)}>{o.label}</button>)}
            </div>
          )}
          <label className="field"><span>Mobile number</span><input inputMode="tel" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="04xx xxx xxx" /></label>
          <label className="field"><span>Text (edit it if you like)</span><textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <p className="calc-note" style={{ marginBottom: 0 }}>This opens in Messages from your own number with the text filled in. Check it and press send there.</p>
          {opened && <p className="calc-note" style={{ color: "var(--good)" }}><Check size={13} style={{ verticalAlign: "-2px" }} /> Opened in Messages.</p>}
        </div>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={copy}>{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy text</>}</button>
          <button className="btn-primary" onClick={open} disabled={digits.length < 8 || !body.trim()}><Send size={15} /> Open in Messages</button>
        </div>
      </div>
    </div>
  );
}
