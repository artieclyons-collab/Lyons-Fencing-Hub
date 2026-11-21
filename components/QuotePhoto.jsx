"use client";
// "Fill in from a photo or screenshot" on a quote: a photo of handwritten site notes, a sketch with measurements, or a screenshot of the client's
// message. Claude copies the details into the same short note lines the quote builder already understands (it never invents a measurement or price),
// you check and fix them here, and then they become quote lines. Nothing changes on the quote until you press "Make the quote lines".
import { useRef, useState } from "react";
import { Camera, Check, X, AlertTriangle } from "lucide-react";

// a phone photo can be 5MB+ and the server only takes about 4MB per request, so it's shrunk first
function shrinkImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ base64: c.toDataURL("image/jpeg", 0.85).split(",")[1], mediaType: "image/jpeg" });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't open that image (HEIC photos from some phones need to be shared as JPEG).")); };
    img.src = url;
  });
}

export default function QuotePhoto({ hasLines, onApply }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [res, setRes] = useState(null); // { notes, unclear, client }
  const [notes, setNotes] = useState("");

  const pick = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 4);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true); setError(""); setRes(null);
    try {
      const images = [];
      for (const f of files) images.push(await shrinkImage(f));
      const r = await fetch("/api/ai/read-quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't read that.");
      if (!String(j.notes || "").trim()) throw new Error("I couldn't find any job details in that. Try a clearer or closer photo, or type the notes in.");
      setRes(j);
      setNotes(j.notes);
    } catch (err) {
      setError(err.message || "Couldn't read that.");
    } finally {
      setBusy(false);
    }
  };
  const apply = () => { onApply({ notes: notes.trim(), client: res?.client || {} }); setRes(null); };
  const c = res?.client || {};
  const clientBits = [c.name, c.phone, c.email, c.address].filter(Boolean);

  return (
    <div style={{ margin: "6px 0 10px" }}>
      <button type="button" className="btn-ghost small" onClick={() => inputRef.current?.click()} disabled={busy} title="A photo of handwritten notes, a sketch, or a screenshot of the client's message">
        <Camera size={14} /> {busy ? "Reading it…" : "Fill in from a photo or screenshot"}
      </button>
      <input type="file" accept="image/*" multiple ref={inputRef} style={{ display: "none" }} onChange={pick} />
      {error && <p className="calc-note" style={{ color: "var(--bad)", margin: "6px 0 0" }}><AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> {error}</p>}
      {res && (
        <div className="email-others" style={{ marginTop: 8 }}>
          <span className="calc-note" style={{ margin: 0 }}>This is what I read. Check it and fix anything before it becomes quote lines (one fence section per line, blank line between separate quotes).</span>
          <textarea rows={Math.min(10, Math.max(4, notes.split("\n").length + 1))} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {res.unclear?.length > 0 && <p className="calc-note" style={{ color: "var(--bad)", margin: 0 }}>Couldn't tell: {res.unclear.join("; ")}</p>}
          {clientBits.length > 0 && <p className="calc-note" style={{ margin: 0 }}>Client details seen: {clientBits.join(" · ")} (only filled in where the quote's boxes are empty).</p>}
          {hasLines && <p className="calc-note" style={{ margin: 0 }}>The quote already has lines, so these are added after them.</p>}
          <div className="modal-actions" style={{ marginTop: 6 }}>
            <button type="button" className="btn-ghost" onClick={() => setRes(null)}><X size={14} /> Cancel</button>
            <button type="button" className="btn-primary" onClick={apply} disabled={!notes.trim()}><Check size={15} /> Make the quote lines</button>
          </div>
        </div>
      )}
    </div>
  );
}
