"use client";
// "Add a visit" on the Visit planner: pick someone you already have (a lead) or type a new person, optionally a day and time, and they go on
// the planner. Nothing else about the lead changes except a "Site visit wanted" line in its notes, which is what the planner looks for.
import { useMemo, useState } from "react";
import { X, Check, MapPin } from "lucide-react";

const norm = (s) => String(s || "").toLowerCase();

export default function AddVisitModal({ leads = [], onSave, onClose }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null); // an existing lead
  const [form, setForm] = useState({ name: "", phone: "", address: "", visitDate: "", visitTime: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const matches = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean);
    if (!words.length || picked) return [];
    return leads
      .filter((l) => l.status !== "Lost" && words.every((w) => norm(`${l.name} ${l.address} ${l.phone}`).includes(w)))
      .slice(0, 5);
  }, [leads, query, picked]);

  const choose = (l) => {
    setPicked(l);
    setQuery("");
    setForm((f) => ({ ...f, name: l.name || "", phone: l.phone || "", address: l.address || "" }));
  };
  const ready = !!form.name.trim() && !!form.address.trim();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>Add a visit</span><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">
          <p className="calc-note" style={{ marginTop: 0 }}>Someone you need to go and see. They go on the planner, which finds the best day, or use the day you pick.</p>

          {picked ? (
            <div className="calc-trigger-row" style={{ alignItems: "center", marginBottom: 10 }}>
              <strong style={{ fontSize: 14 }}>{picked.name}</strong>
              <span className="calc-note" style={{ margin: 0 }}>{picked.status}</span>
              <button type="button" className="link-btn" onClick={() => { setPicked(null); setForm({ name: "", phone: "", address: "", visitDate: form.visitDate, visitTime: form.visitTime }); }}>Change</button>
            </div>
          ) : (
            <label className="field">
              <span>Find someone you already have (or fill in a new person below)</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a name, address or number" />
              {matches.map((l) => (
                <button key={l.id} type="button" className="btn-ghost small" style={{ justifyContent: "flex-start", textAlign: "left", marginTop: 4 }} onClick={() => choose(l)}>
                  {l.name} <span className="calc-note" style={{ margin: "0 0 0 6px" }}>{[l.address, l.status].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
            </label>
          )}

          <label className="field"><span>Name</span><input value={form.name} onChange={(e) => set("name", e.target.value)} disabled={!!picked} /></label>
          <label className="field"><span><MapPin size={12} style={{ verticalAlign: "-2px" }} /> Address</span><input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Street and suburb" /></label>
          <label className="field"><span>Mobile (optional)</span><input inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} disabled={!!(picked && picked.phone)} /></label>
          <div className="field-pair">
            <label className="field"><span>Day (optional)</span><input type="date" value={form.visitDate} onChange={(e) => set("visitDate", e.target.value)} /></label>
            <label className="field"><span>Time (optional)</span><input type="time" value={form.visitTime} onChange={(e) => set("visitTime", e.target.value)} /></label>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-primary" disabled={!ready} onClick={() => onSave({ leadId: picked?.id || null, ...form, name: form.name.trim(), address: form.address.trim() })}><Check size={15} /> Add to planner</button>
        </div>
      </div>
    </div>
  );
}
