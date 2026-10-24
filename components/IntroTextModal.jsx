"use client";
// The first text to a new lead: a draft you can pick the job for and edit, then one tap opens it in Messages (from your own number)
// ready to send. After that it asks "did you send it?" and only then marks the lead Contacted.
import { useState, useEffect } from "react";
import { Send, Copy, Check, X } from "lucide-react";
import { INTRO_TEXTS, JOB_PHRASES, jobPhrase, introDraft, smsLink } from "@/lib/introText";

const TEXTS_KEY = "lyons:texts"; // same saved wording as Texts to send

export default function IntroTextModal({ lead, onClose, onSent }) {
  const [texts, setTexts] = useState(INTRO_TEXTS);
  const [job, setJob] = useState(jobPhrase(lead));
  const [body, setBody] = useState(() => introDraft(lead, INTRO_TEXTS, jobPhrase(lead)));
  const [edited, setEdited] = useState(false);
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const saved = { ...INTRO_TEXTS, ...(JSON.parse(window.localStorage.getItem(TEXTS_KEY) || "{}") || {}) };
      setTexts(saved);
      setBody(introDraft(lead, saved, jobPhrase(lead)));
    } catch { /* no saved wording: the default stands */ }
  }, [lead]);

  // Picking a different job rewrites the draft, unless you've already changed the text yourself.
  const pickJob = (j) => {
    setJob(j);
    if (!edited) setBody(introDraft(lead, texts, j));
  };
  const open = () => {
    setOpened(true);
    window.location.href = smsLink(lead.phone, body);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard blocked: nothing to do */ }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Text {lead.name || "lead"}</span>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="calc-note">{lead.source === "hipages" ? "A hipages lead" : "A new lead"} · {lead.phone}{lead.address ? ` · ${lead.address}` : ""}</p>
          <label className="field">
            <span>The job</span>
            <select value={job} onChange={(e) => pickJob(e.target.value)}>
              {[...new Set([job, ...JOB_PHRASES])].map((j) => <option key={j}>{j}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Text</span>
            <textarea rows={11} value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} />
          </label>
          {opened ? (
            <div className="text-confirm">
              Did you send it?
              <button className="btn-primary small" onClick={() => { onSent(lead); onClose(); }}><Check size={13} /> Yes, sent</button>
              <button className="btn-ghost small" onClick={() => setOpened(false)}>Not yet</button>
            </div>
          ) : (
            <div className="modal-actions">
              <button className="btn-ghost" onClick={copy}>{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy text</>}</button>
              <button className="btn-primary" onClick={open}><Send size={15} /> Open in Messages</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
