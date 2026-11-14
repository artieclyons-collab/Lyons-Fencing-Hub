"use client";
// "Texts to send" on the Board: quote follow-ups and invoice chasers, each one tap to open a ready-written text in
// Messages from Artie's own number. It can't send by itself (a web page can't), so after the tap it asks "did you
// send it?" and only then marks it done, so it stops showing until it's due again.
import { useState, useEffect, useMemo } from "react";
import { Send, Copy, Check, Pencil, X, Phone, Mail } from "lucide-react";
import EmailModal from "./EmailModal";
import IntroTextModal from "./IntroTextModal";
import { smsLink } from "@/lib/introText";
import { FOLLOW_UP_DAYS } from "@/lib/schedule";
import { DEFAULT_TEXTS, CHASE_DAYS, dueTexts } from "@/lib/dueTexts";

const TEXTS_KEY = "lyons:texts";
const SHOW_FIRST = 6; // the rest sit behind "Show more" so the Board doesn't get long
const emailKind = { quote: "followup", job: "start", invoice: "chase", review: "review" };

export default function TextsToSend({ quotes, invoices, leads, setQuotes, setInvoices, setLeads }) {
  const [texts, setTexts] = useState(DEFAULT_TEXTS);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(null); // key waiting for "did you send it?"
  const [copied, setCopied] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [emailing, setEmailing] = useState(null); // the item whose email is being prepared
  const [intro, setIntro] = useState(null); // the new lead whose first text is being written
  useEffect(() => {
    try { setTexts({ ...DEFAULT_TEXTS, ...(JSON.parse(window.localStorage.getItem(TEXTS_KEY) || "{}") || {}) }); } catch {}
  }, []);
  const saveTexts = (next) => {
    setTexts(next);
    try { window.localStorage.setItem(TEXTS_KEY, JSON.stringify(next)); } catch {}
  };

  const due = useMemo(() => dueTexts({ quotes, invoices, leads }, texts), [quotes, invoices, leads, texts]);

  const markContacted = (lead) => setLeads?.((ls) => ls.map((l) => (l.id === lead.id && l.status === "New" ? { ...l, status: "Contacted" } : l)));
  const markDone = (item) => {
    if (item.kind === "lead") { markContacted(item.lead); setPending(null); return; }
    // the mark goes on the quote (a review asked for the whole job) or the invoice, as the item says
    const targetId = item.mark.id || item.id;
    const patch = (rows) => rows.map((r) => (r.id === targetId ? { ...r, [item.mark.field]: item.mark.value } : r));
    const onInvoices = item.mark.table ? item.mark.table === "invoices" : item.kind === "invoice" || item.kind === "review";
    if (onInvoices) setInvoices(patch);
    else setQuotes(patch);
    setPending(null);
  };
  const open = (item) => {
    if (item.kind === "lead") { setIntro(item.lead); return; }
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
        New hipages leads (a first text, written for you to check and edit), start dates for booked jobs (and if one moves), quote follow-ups ({FOLLOW_UP_DAYS} days after sending) and invoice chasers ({CHASE_DAYS} days after issuing). Tap to open the text in Messages from your own number, then check it and send.
      </p>
      {(showAll ? due : due.slice(0, SHOW_FIRST)).map((item) => (
        <div key={item.key} className="text-row">
          <div className="upcoming-date">{item.badge}</div>
          <div className="text-main">
            <div className="upcoming-name">{item.who}</div>
            <div className="upcoming-sub">{item.kind === "invoice" ? "Invoice" : item.kind === "review" ? "Review request" : item.kind === "job" ? "Booked job" : item.kind === "ask" ? "Before the job starts" : item.kind === "lead" ? "New hipages lead" : "Quote"} · {item.what}</div>
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
                {item.email && <button className="btn-ghost small" onClick={() => setEmailing(item)} title={`Email ${item.email}`}><Mail size={13} /> Email</button>}
                <button className="btn-ghost small" onClick={() => copy(item)}>{copied === item.key ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy text</>}</button>
                <button className="btn-ghost small" onClick={() => markDone(item)} title="Already dealt with it another way">Done</button>
              </div>
            )}
          </div>
        </div>
      ))}
      {due.length > SHOW_FIRST && (
        <button className="link-btn" style={{ marginTop: 10 }} onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show ${due.length - SHOW_FIRST} more`}</button>
      )}
      {emailing && <EmailModal kind={emailKind[emailing.kind]} id={emailing.id} title={`Email ${emailing.who}`} onClose={() => setEmailing(null)} />}
      {intro && <IntroTextModal lead={intro} onClose={() => setIntro(null)} onSent={markContacted} />}
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
          <p className="calc-note">Saved on this device. You can use these blanks and they're filled in for each client: <code>{"{name}"}</code> first name, <code>{"{quote}"}</code> "the fencing quote (LFS529)" or, with several out, "the fencing quotes (LFS529 and LFS530)", <code>{"{doc}"}</code> quote or invoice number, <code>{"{ago}"}</code> how long ago it was sent, said casually ("a week ago", "a couple of weeks ago"), <code>{"{days}"}</code> the number of days since it was sent, <code>{"{total}"}</code> amount inc. GST, <code>{"{date}"}</code> the start date, <code>{"{link}"}</code> your Google review link, <code>{"{what}"}</code> "invoice INV-123" or "the deposit invoice INV-123", <code>{"{job}"}</code> type of job.</p>
          <label className="field">
            <span>Quote follow-up</span>
            <textarea rows={4} value={form.followUp} onChange={(e) => setForm({ ...form, followUp: e.target.value })} />
          </label>
          <button className="link-btn" onClick={() => setForm({ ...form, followUp: DEFAULT_TEXTS.followUp })}>Reset this one</button>
          <label className="field" style={{ marginTop: 12 }}>
            <span>First text to a new hipages lead (blanks: {"{name}"}, {"{job}"})</span>
            <textarea rows={8} value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} />
          </label>
          <button className="link-btn" onClick={() => setForm({ ...form, intro: DEFAULT_TEXTS.intro })}>Reset this one</button>
          <label className="field" style={{ marginTop: 12 }}>
            <span>First text to any other new lead</span>
            <textarea rows={8} value={form.introOther} onChange={(e) => setForm({ ...form, introOther: e.target.value })} />
          </label>
          <button className="link-btn" onClick={() => setForm({ ...form, introOther: DEFAULT_TEXTS.introOther })}>Reset this one</button>
          <label className="field" style={{ marginTop: 12 }}>
            <span>Start date (confirming a booked job)</span>
            <textarea rows={3} value={form.startConfirm} onChange={(e) => setForm({ ...form, startConfirm: e.target.value })} />
          </label>
          <button className="link-btn" onClick={() => setForm({ ...form, startConfirm: DEFAULT_TEXTS.startConfirm })}>Reset this one</button>
          <label className="field" style={{ marginTop: 12 }}>
            <span>Start date has changed</span>
            <textarea rows={3} value={form.startChange} onChange={(e) => setForm({ ...form, startChange: e.target.value })} />
          </label>
          <button className="link-btn" onClick={() => setForm({ ...form, startChange: DEFAULT_TEXTS.startChange })}>Reset this one</button>
          <label className="field" style={{ marginTop: 12 }}>
            <span>Review request (the link comes from your business details)</span>
            <textarea rows={4} value={form.review} onChange={(e) => setForm({ ...form, review: e.target.value })} />
          </label>
          <button className="link-btn" onClick={() => setForm({ ...form, review: DEFAULT_TEXTS.review })}>Reset this one</button>
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
