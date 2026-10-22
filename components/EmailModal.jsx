"use client";
// "Email this" — shows who the email goes to and the wording (editable), then sends it from the business Gmail account.
// The address always comes from the saved quote/invoice/lead (the server decides), so a typo here can't misdirect it.
import { useState, useEffect } from "react";
import { Send, Check, X, Paperclip, AlertTriangle } from "lucide-react";

async function api(body) {
  const res = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

// kind: quote | followup | start | invoice | chase. id: the saved quote or invoice.
export default function EmailModal({ kind, id, title, onClose, onSent }) {
  const [state, setState] = useState("loading"); // loading | ready | sending | sent | error
  const [info, setInfo] = useState(null); // { to, from, subject, body, attachment, configured, name }
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    let off = false;
    api({ kind, id, preview: true }).then((r) => {
      if (off) return;
      if (!r.ok) { setMessage(r.json.error || "Couldn't prepare that email."); setState("error"); return; }
      setInfo(r.json);
      setSubject(r.json.subject);
      setText(r.json.body);
      setState("ready");
    }).catch(() => { if (!off) { setMessage("Couldn't reach the hub."); setState("error"); } });
    return () => { off = true; };
  }, [kind, id]);

  const send = async () => {
    setState("sending");
    setMessage("");
    try {
      const r = await api({ kind, id, subject, body: text });
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

  const cannotSend = !info || !info.configured || !info.to;
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
              {!info.to && info.configured && (
                <p className="calc-note" style={{ color: "var(--bad)" }}>There's no email address saved for {info.name || "this client"}. Add one (on the quote, invoice or lead) and save, then come back.</p>
              )}
              <div className="email-meta">
                <div><span>From</span><strong>{info.from || "—"}</strong></div>
                <div><span>To</span><strong>{info.to || "—"}</strong></div>
                {info.attachment && <div><span>Attached</span><strong><Paperclip size={12} style={{ verticalAlign: "-1px" }} /> {info.attachment}</strong></div>}
              </div>
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
              <p className="calc-note" style={{ marginBottom: 0 }}>Nothing is sent until you tap Send. It's sent from your business Gmail, so replies land in that inbox.</p>
            </>
          )}

          {state === "sent" && (
            <>
              <p className="calc-note" style={{ color: "var(--good)" }}><Check size={14} style={{ verticalAlign: "-2px" }} /> {result?.test ? "Test mode: built the email but didn't send it." : `Sent to ${result?.to}.`} {(result?.marked || []).join(" ")}</p>
              {result?.attached?.length > 0 && <p className="calc-note">Attached: {result.attached.join(", ")}</p>}
              <div className="modal-actions"><button className="btn-primary" onClick={onClose}><Check size={15} /> Done</button></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
