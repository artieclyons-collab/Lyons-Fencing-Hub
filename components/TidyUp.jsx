"use client";
// A small "tidy up" notice at the top of a list: says what's cluttering it and offers one button to sort it out.
// Nothing happens until the button is pressed and the confirmation is accepted.
import { Sparkles } from "lucide-react";

export default function TidyUp({ text, button, confirm, onDo, danger = false }) {
  return (
    <div className="panel" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", marginBottom: 12 }}>
      <Sparkles size={15} style={{ flex: "none", color: "var(--text-dim)" }} />
      <span style={{ flex: 1, minWidth: 180, fontSize: 13.5 }}>{text}</span>
      <button type="button" className={danger ? "btn-danger small" : "btn-ghost small"} onClick={() => { if (window.confirm(confirm)) onDo(); }}>{button}</button>
    </div>
  );
}
