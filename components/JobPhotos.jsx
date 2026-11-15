"use client";
// "Job photos" on an accepted quote: before / after / other photos kept in private storage (not in the data tables), and a sign-off link the
// client opens to look at them and confirm the work's finished. Photos are shrunk on the phone before they go up.
import { useEffect, useState } from "react";
import { Camera, Trash2, Share2, Check, Send } from "lucide-react";
import { smsLink, firstName } from "@/lib/introText";

function shrink(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.8).split(",")[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't open that photo (HEIC photos may need to be shared as JPEG).")); };
    img.src = url;
  });
}

const KIND_LABEL = { before: "Before", after: "After", other: "Other" };

export default function JobPhotos({ quote }) {
  const [state, setState] = useState({ photos: [], signoff: null, loading: true });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const id = quote?.id;

  const load = async () => {
    try {
      const res = await fetch(`/api/photos?quote=${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't load the photos.");
      setState({ photos: body.photos || [], signoff: body.signoff, loading: false });
    } catch (e) { setError(e.message); setState((s) => ({ ...s, loading: false })); }
  };
  useEffect(() => { if (id) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const add = async (kind, files) => {
    setBusy(kind); setError("");
    try {
      for (const f of Array.from(files || [])) {
        const base64 = await shrink(f);
        const res = await fetch("/api/photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId: id, kind, base64, mediaType: "image/jpeg" }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't save a photo.");
      }
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const remove = async (p) => {
    if (!window.confirm("Delete this photo?")) return;
    const res = await fetch("/api/photos", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p.path }) });
    if (res.ok) setState((s) => ({ ...s, photos: s.photos.filter((x) => x.path !== p.path) }));
  };

  const link = typeof window !== "undefined" ? `${window.location.origin}/done/${id}` : "";
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch {} };
  const text = () => {
    const body = `Hi ${firstName(quote.clientName)},\n\nThe fence is all finished. Have a look at the photos and the fence, and if you're happy, you can confirm it here:\n${link}\n\nCheers,\nArtie`;
    window.location.href = smsLink(quote.clientPhone, body);
  };

  const hasAfter = state.photos.some((p) => p.kind === "after");
  return (
    <div className="calc-preview" style={{ marginTop: 12 }}>
      <div className="cf-label" style={{ marginBottom: 6 }}>Job photos</div>
      {state.loading ? <div className="calc-note" style={{ margin: 0 }}>Loading…</div> : (
        <>
          {["before", "after", "other"].map((k) => {
            const list = state.photos.filter((p) => p.kind === k);
            return (
              <div key={k} style={{ marginBottom: 8 }}>
                <div className="calc-trigger-row" style={{ alignItems: "center", marginBottom: 4 }}>
                  <strong style={{ fontSize: 13 }}>{KIND_LABEL[k]} ({list.length})</strong>
                  <label className="btn-ghost small" style={{ cursor: "pointer" }}><Camera size={13} /> {busy === k ? "Saving…" : "Add"}<input type="file" accept="image/*" multiple hidden disabled={!!busy} onChange={(e) => { add(k, e.target.files); e.target.value = ""; }} /></label>
                </div>
                {list.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {list.map((p) => (
                      <div key={p.path} style={{ position: "relative" }}>
                        <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={KIND_LABEL[k]} style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 8, display: "block" }} /></a>
                        <button type="button" className="icon-btn" style={{ position: "absolute", top: -6, right: -6 }} onClick={() => remove(p)} aria-label="Delete photo"><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {error && <p className="calc-note" style={{ color: "var(--bad)" }}>{error}</p>}
          {state.signoff ? (
            <p className="calc-note" style={{ margin: "6px 0 0", color: "var(--good)" }}><Check size={13} style={{ verticalAlign: "-2px" }} /> Signed off by {state.signoff.name} on {new Date(state.signoff.at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}.</p>
          ) : (
            <div className="calc-trigger-row" style={{ marginTop: 6 }}>
              <button type="button" className="btn-ghost small" disabled={!hasAfter} title={hasAfter ? "" : "Add an After photo first"} onClick={copy}>{copied ? <><Check size={13} /> Link copied</> : <><Share2 size={13} /> Copy sign-off link</>}</button>
              {quote.clientPhone && <button type="button" className="btn-primary small" disabled={!hasAfter} onClick={text}><Send size={13} /> Text the sign-off link</button>}
              {!hasAfter && <span className="calc-note" style={{ margin: 0 }}>Add an After photo to send the client a sign-off link.</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
