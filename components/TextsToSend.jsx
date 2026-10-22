"use client";
// "Texts to send" on the Board: quote follow-ups and invoice chasers, each one tap to open a ready-written text in
// Messages from Artie's own number. It can't send by itself (a web page can't), so after the tap it asks "did you
// send it?" and only then marks it done, so it stops showing until it's due again.
import { useState, useEffect, useMemo } from "react";
import { Send, Copy, Check, Pencil, X, Phone } from "lucide-react";
import { money, today, itemsTotal, gstBreakdown, isDepositInvoice } from "@/lib/logic";
import { FOLLOW_UP_DAYS } from "@/lib/schedule";

export const CHASE_DAYS = 7; // an invoice is chased this long after it was issued
const REPEAT_DAYS = 7; // and again this long after each text
const QUOTE_WINDOW_DAYS = 30; // follow-ups stop after a month (a quote that old is probably dead)
const TEXTS_KEY = "lyons:texts";

export const DEFAULT_TEXTS = {
  followUp: "Hi {name}, it's Artie from Lyons Fencing. Just following up on the fencing quote ({doc}) I sent through {days} days ago. Let me know if you have any questions or would like to go ahead. Cheers, Artie",
  chase: "Hi {name}, it's Artie from Lyons Fencing. Just a quick reminder that {what} for {total} is still outstanding. The payment details are on the invoice. Let me know if you have any questions. Thanks, Artie",
};

const daysAgo = (iso) => {
  if (!iso) return null;
  return Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(`${iso}T00:00:00`).setHours(0, 0, 0, 0)) / 86400000);
};
const first = (name) => {
  const n = String(name || "").replace(/\(.*?\)/g, "").trim().split(/\s+/)[0] || "";
  return /^(n\/?a|lead|client)$/i.test(n) ? "" : n;
};
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const incTotal = (items) => gstBreakdown(itemsTotal(items)).total;
const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)).replace(/^Hi ,/, "Hi,");
const smsLink = (phone, body) => {
  const sep = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "&" : "?";
  return `sms:${String(phone).replace(/[^\d+]/g, "")}${sep}body=${encodeURIComponent(body)}`;
};

// Everything due right now, oldest first. `texts` is the wording; leads/quotes supply phone numbers for invoices.
export function dueTexts({ quotes, invoices, leads }, texts = DEFAULT_TEXTS) {
  const out = [];
  for (const q of quotes) {
    if (q.status !== "Sent") continue;
    const age = daysAgo(q.date);
    if (age == null || age < FOLLOW_UP_DAYS || age > QUOTE_WINDOW_DAYS) continue;
    const since = daysAgo(q.lastFollowUp);
    if (since != null && since < REPEAT_DAYS) continue;
    const body = fill(texts.followUp, { name: first(q.clientName), doc: q.docNumber || "quote", days: age, total: money(incTotal(q.items)), job: q.jobType || "fencing" });
    out.push({ key: `q:${q.id}`, kind: "quote", id: q.id, age, who: q.clientName || "Client", what: `${q.jobType || "Quote"} · ${money(incTotal(q.items))} inc. GST`, label: since != null ? "Follow up again" : "Follow up", phone: q.clientPhone || "", body });
  }
  const phoneFor = (inv) => {
    const q = quotes.find((x) => x.id === inv.quoteId) || quotes.find((x) => x.clientPhone && norm(x.clientName) === norm(inv.clientName));
    if (q?.clientPhone) return q.clientPhone;
    return leads.find((l) => l.phone && norm(l.name) === norm(inv.clientName))?.phone || "";
  };
  for (const i of invoices) {
    if (i.status === "Paid") continue;
    const age = daysAgo(i.issuedDate);
    if (age == null || age < CHASE_DAYS) continue;
    const since = daysAgo(i.lastChase);
    if (since != null && since < REPEAT_DAYS) continue;
    const total = money(incTotal(i.items));
    const what = `${isDepositInvoice(i) ? "the deposit invoice" : "invoice"}${i.docNumber ? ` ${i.docNumber}` : ""}`;
    const body = fill(texts.chase, { name: first(i.clientName), doc: i.docNumber || "invoice", what, total, days: age });
    out.push({ key: `i:${i.id}`, kind: "invoice", id: i.id, age, who: i.clientName || "Client", what: `${i.docNumber || "Invoice"} · ${total} inc. GST`, label: since != null ? "Chase again" : "Chase payment", phone: phoneFor(i), body });
  }
  return out.sort((a, b) => b.age - a.age);
}

export default function TextsToSend({ quotes, invoices, leads, setQuotes, setInvoices }) {
  const [texts, setTexts] = useState(DEFAULT_TEXTS);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(null); // key waiting for "did you send it?"
  const [copied, setCopied] = useState(null);
  useEffect(() => {
    try { setTexts({ ...DEFAULT_TEXTS, ...(JSON.parse(window.localStorage.getItem(TEXTS_KEY) || "{}") || {}) }); } catch {}
  }, []);
  const saveTexts = (next) => {
    setTexts(next);
    try { window.localStorage.setItem(TEXTS_KEY, JSON.stringify(next)); } catch {}
  };

  const due = useMemo(() => dueTexts({ quotes, invoices, leads }, texts), [quotes, invoices, leads, texts]);

  const markDone = (item) => {
    const patch = (rows, field) => rows.map((r) => (r.id === item.id ? { ...r, [field]: today() } : r));
    if (item.kind === "quote") setQuotes((rows) => patch(rows, "lastFollowUp"));
    else setInvoices((rows) => patch(rows, "lastChase"));
    setPending(null);
  };
  const open = (item) => {
    setPending(item.key);
    window.location.href = smsLink(item.phone, item.body);
  };
  const copy = async (item) => {
    try {
      await navigator.clipboard.writeText(item.body);
      setCopied(item.key);
      setTimeout(() => setCopied(null), 2500);
    } catch {}
  };

  if (due.length === 0) return null;
  return (
    <div className="panel">
      <div className="panel-head">
        <Send size={16} />
        <span>Texts to send ({due.length})</span>
        <button className="link-btn" style={{ marginLeft: "auto" }} onClick={() => setEditing(true)}><Pencil size={12} /> Edit wording</button>
      </div>
      <p className="calc-note" style={{ marginBottom: 10 }}>
        Quote follow-ups ({FOLLOW_UP_DAYS} days after sending) and invoice chasers ({CHASE_DAYS} days after issuing). Tap to open the text in Messages from your own number, then check it and send.
      </p>
      {due.map((item) => (
        <div key={item.key} className="text-row">
          <div className="upcoming-date">{item.age}d</div>
          <div className="text-main">
            <div className="upcoming-name">{item.who}</div>
            <div className="upcoming-sub">{item.kind === "invoice" ? "Invoice" : "Quote"} · {item.what}</div>
            {pending === item.key ? (
              <div className="text-confirm">
                Did you send it?
                <button className="btn-primary small" onClick={() => markDone(item)}><Check size={13} /> Yes, sent</button>
                <button className="btn-ghost small" onClick={() => setPending(null)}>Not yet</button>
              </div>
            ) : (
              <div className="text-actions">
                {item.phone ? (
                  <button className={`btn-primary small${item.kind === "invoice" ? " chase" : ""}`} onClick={() => open(item)}><Send size={13} /> {item.label}</button>
                ) : (
                  <span className="calc-note" style={{ margin: 0 }}><Phone size={12} /> No phone number on file</span>
                )}
                <button className="btn-ghost small" onClick={() => copy(item)}>{copied === item.key ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy text</>}</button>
                <button className="btn-ghost small" onClick={() => markDone(item)} title="Already dealt with it another way">Done</button>
              </div>
            )}
          </div>
        </div>
      ))}
      {editing && <WordingModal texts={texts} onSave={(t) => { saveTexts(t); setEditing(false); }} onClose={() => setEditing(false)} />}
    </div>
  );
}

function WordingModal({ texts, onSave, onClose }) {
  const [form, setForm] = useState(texts);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Wording of your texts</span>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="calc-note">Saved on this device. You can use these blanks and they're filled in for each client: <code>{"{name}"}</code> first name, <code>{"{doc}"}</code> quote or invoice number, <code>{"{days}"}</code> days since it was sent, <code>{"{total}"}</code> amount inc. GST, <code>{"{what}"}</code> "invoice INV-123" or "the deposit invoice INV-123", <code>{"{job}"}</code> type of job.</p>
          <label className="field">
            <span>Quote follow-up</span>
            <textarea rows={4} value={form.followUp} onChange={(e) => setForm({ ...form, followUp: e.target.value })} />
          </label>
          <button className="link-btn" onClick={() => setForm({ ...form, followUp: DEFAULT_TEXTS.followUp })}>Reset this one</button>
          <label className="field" style={{ marginTop: 12 }}>
            <span>Invoice chaser</span>
            <textarea rows={4} value={form.chase} onChange={(e) => setForm({ ...form, chase: e.target.value })} />
          </label>
          <button className="link-btn" onClick={() => setForm({ ...form, chase: DEFAULT_TEXTS.chase })}>Reset this one</button>
          <div className="modal-actions">
            <button className="btn-primary" onClick={() => onSave(form)}><Check size={15} /> Save wording</button>
          </div>
        </div>
      </div>
    </div>
  );
}
