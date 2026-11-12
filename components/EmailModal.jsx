"use client";
// "Email this" — shows who the email goes to and the wording (editable), then sends it from the business Gmail account.
// The address always comes from the saved quote/invoice/lead (the server decides), so a typo here can't misdirect it.
import { useState, useEffect } from "react";
import { Send, Check, X, Paperclip, AlertTriangle, Pencil, Plus } from "lucide-react";
import { itemsTotal, gstBreakdown, money, uid } from "@/lib/logic";

async function api(body) {
  const res = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

// kind: quote | followup | start | invoice | chase. id: the saved quote or invoice.
export default function EmailModal({ kind, id, title, onClose, onSent, onText }) {
  const [state, setState] = useState("loading"); // loading | ready | sending | sent | error
  const [info, setInfo] = useState(null); // { to, from, subject, body, attachment, configured, name }
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);
  const [extra, setExtra] = useState([]); // other documents for the same client going in the same email
  const isInvoice = kind === "invoice" || kind === "chase";
  const [adj, setAdj] = useState(null); // the invoice being adjusted before it's sent
  const [adjBusy, setAdjBusy] = useState(false);
  const [reload, setReload] = useState(0); // bumps after the invoice is saved so the email is rebuilt from it
  const openAdjust = async () => {
    setAdjBusy(true);
    try {
      const rows = await fetch("/api/data/invoices", { cache: "no-store" }).then((r) => r.json()).then((j) => j.rows || []);
      const inv = rows.find((r) => r.id === id);
      if (inv) setAdj({ ...inv, items: (inv.items || []).map((it) => ({ ...it, id: it.id || uid() })) });
    } finally { setAdjBusy(false); }
  };
  const saveAdjust = async () => {
    setAdjBusy(true);
    try {
      const res = await fetch("/api/data/invoices", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: [adj] }) });
      if (!res.ok) throw new Error("save failed");
      setAdj(null);
      setReload((n) => n + 1);
      window.dispatchEvent(new Event("hub-refresh"));
    } catch { setMessage("Couldn't save the changes to the invoice — nothing was changed."); }
    finally { setAdjBusy(false); }
  };
  const setLine = (lid, k, v) => setAdj((a) => ({ ...a, items: a.items.map((it) => (it.id === lid ? { ...it, [k]: v } : it)) }));

  useEffect(() => {
    let off = false;
    api({ kind, id, ids: extra, preview: true }).then((r) => {
      if (off) return;
      if (!r.ok) { setMessage(r.json.error || "Couldn't prepare that email."); setState("error"); return; }
      setInfo(r.json);
      setSubject(r.json.subject);
      setText(r.json.body);
      setState("ready");
    }).catch(() => { if (!off) { setMessage("Couldn't reach the hub."); setState("error"); } });
    return () => { off = true; };
  }, [kind, id, extra.join(","), reload]);

  const send = async () => {
    setState("sending");
    setMessage("");
    try {
      const r = await api({ kind, id, ids: extra, subject, body: text });
      if (!r.ok) { setMessage(r.json.error || "Couldn't send that."); setState("ready"); return; }
      setResult(r.json);
      setState("sent");
      window.dispatchEvent(new Event("hub-refresh"));
      onSent?.(r.json);
    } catch {
      setMessage("Couldn't reach the hub — nothing was sent.");
      setState("ready");
    }
  };

  const cannotSend = !info || !info.configured || !info.to || !!info.suggest || !!adj; // not while an adjustment is unsaved
  return (
    <div className="modal-overlay" onClick={state === "sending" ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{title || "Email"}</span>
          <button className="icon-btn" onClick={onClose} disabled={state === "sending"}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {state === "loading" && <p className="calc-note">Getting it ready…</p>}
          {state === "error" && <p className="calc-note" style={{ color: "var(--bad)" }}><AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> {message}</p>}

          {(state === "ready" || state === "sending") && info && (
            <>
              {!info.configured && (
                <p className="calc-note" style={{ color: "var(--bad)" }}>Email isn't set up yet. Add the Gmail address and app password in Vercel (steps are in the README), then try again.</p>
              )}
              {info.suggest && (
                <p className="calc-note" style={{ color: "var(--bad)" }}><AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> That address looks misspelled. Did you mean <strong>{info.suggest}</strong>? Fix it on the quote (or lead), save, and come back — it won't send as it is.</p>
              )}
              {!info.to && info.configured && (
                <p className="calc-note" style={{ color: "var(--bad)" }}>There's no email address saved for {info.name || "this client"}. Add one (on the quote, invoice or lead) and save, then come back.</p>
              )}
              <div className="email-meta">
                <div><span>From</span><strong>{info.from || "—"}</strong></div>
                <div><span>To</span><strong>{info.to || "—"}</strong></div>
                {info.attachments?.length > 0 && <div><span>Attached</span><strong>{info.attachments.map((a) => <span key={a} style={{ display: "block", color: "inherit", minWidth: 0 }}><Paperclip size={12} style={{ verticalAlign: "-1px" }} /> {a}</span>)}</strong></div>}
              </div>
              {isInvoice && !adj && (
                <button type="button" className="link-btn" onClick={openAdjust} disabled={adjBusy}><Pencil size={13} /> Adjust the invoice before sending (lines, amounts, due date, notes)</button>
              )}
              {isInvoice && adj && (
                <div className="email-others">
                  <span className="calc-note" style={{ margin: 0 }}>Adjust invoice {adj.docNumber || ""} — it's saved when you press Save changes, and the email is rebuilt from it.</span>
                  {adj.items.map((it) => (
                    <div key={it.id} className="line-item">
                      <input className="li-desc" placeholder="Description" value={it.desc || ""} onChange={(e) => setLine(it.id, "desc", e.target.value)} />
                      <input className="li-num" type="number" placeholder="Qty" value={it.qty ?? ""} onChange={(e) => setLine(it.id, "qty", e.target.value)} />
                      <input className="li-num" type="number" placeholder="Rate" value={it.rate ?? ""} onChange={(e) => setLine(it.id, "rate", e.target.value)} />
                      <button type="button" className="icon-btn" onClick={() => setAdj((a) => ({ ...a, items: a.items.filter((x) => x.id !== it.id) }))} aria-label="Remove line"><X size={14} /></button>
                    </div>
                  ))}
                  <button type="button" className="btn-ghost small" onClick={() => setAdj((a) => ({ ...a, items: [...a.items, { id: uid(), desc: "", qty: 1, rate: 0 }] }))}><Plus size={13} /> Add line</button>
                  <label className="field"><span>Due date</span><input type="date" value={adj.dueDate || ""} onChange={(e) => setAdj((a) => ({ ...a, dueDate: e.target.value }))} /></label>
                  <label className="field"><span>Notes on the invoice</span><textarea rows={3} value={adj.notes || ""} onChange={(e) => setAdj((a) => ({ ...a, notes: e.target.value }))} /></label>
                  <p className="calc-note" style={{ margin: 0 }}>Total inc. GST: <strong>{money(gstBreakdown(itemsTotal(adj.items)).total)}</strong></p>
                  <div className="modal-actions" style={{ marginTop: 6 }}>
                    <button type="button" className="btn-ghost" onClick={() => setAdj(null)} disabled={adjBusy}>Cancel</button>
                    <button type="button" className="btn-primary" onClick={saveAdjust} disabled={adjBusy}><Check size={15} /> {adjBusy ? "Saving…" : "Save changes"}</button>
                  </div>
                </div>
              )}
              {info.others?.length > 0 && (
                <div className="email-others">
                  <span className="calc-note" style={{ margin: 0 }}>Also include {info.name ? `${info.name}'s` : "this client's"} other {kind === "quote" ? "quotes" : "invoices"} in the same email:</span>
                  {info.others.map((o) => (
                    <label key={o.id} className="check-row">
                      <input type="checkbox" checked={extra.includes(o.id)} onChange={(e) => setExtra((x) => (e.target.checked ? [...x, o.id] : x.filter((y) => y !== o.id)))} />
                      <span>{o.label}</span>
                    </label>
                  ))}
                </div>
              )}
              <label className="field">
                <span>Subject</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </label>
              <label className="field">
                <span>Message</span>
                <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              {message && <p className="calc-note" style={{ color: "var(--bad)" }}>{message}</p>}
              <div className="modal-actions">
                <button className="btn-primary" onClick={send} disabled={cannotSend || state === "sending" || !subject.trim() || !text.trim()}>
                  <Send size={15} /> {state === "sending" ? "Sending…" : `Send to ${info.to || "…"}`}
                </button>
              </div>
              <p className="calc-note" style={{ marginBottom: 0 }}>Nothing is sent until you tap Send. Your sign-off, signature and logo are added automatically. It's sent from your business Gmail, so replies land in that inbox.</p>
            </>
          )}

          {state === "sent" && (
            <>
              <p className="calc-note" style={{ color: "var(--good)" }}><Check size={14} style={{ verticalAlign: "-2px" }} /> {result?.test ? "Test mode: built the email but didn't send it." : `Sent to ${result?.to}.`} {(result?.marked || []).join(" ")}</p>
              {result?.attached?.length > 0 && <p className="calc-note">Attached: {result.attached.join(", ")}</p>}
              {onText && !result?.test && <p className="calc-note">Want to let them know by text too?</p>}
              <div className="modal-actions">
                {onText && !result?.test && <button className="btn-ghost" onClick={onText}><Send size={15} /> Text them to say it's sent</button>}
                <button className="btn-primary" onClick={onClose}><Check size={15} /> Done</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
