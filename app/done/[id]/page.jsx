"use client";
// Public page a client opens from your text once the job's finished: they look at the before and after photos and confirm the work is done.
// Same trust as the quote accept page: the unguessable quote id in the link. It's a simple "digital handshake", not a legal e-signature.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const page = { background: "#f4f4f2", minHeight: "100vh", padding: "24px 12px", fontFamily: "'Barlow', Arial, sans-serif", color: "#1C1F1D" };
const wrap = { maxWidth: 720, margin: "0 auto" };
const box = { background: "#fff", borderRadius: 10, padding: "20px 22px", marginTop: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" };
const btn = { background: "#E8B923", color: "#1C1F1D", border: "none", borderRadius: 6, padding: "12px 20px", fontWeight: 600, cursor: "pointer", fontSize: 15 };
const input = { width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 15, boxSizing: "border-box", fontFamily: "inherit" };

export default function DonePage() {
  const id = useParams()?.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/done/${id}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) setError(res.status === 404 ? "We couldn't find that job. The link may be out of date: please contact Lyons Fencing & Services." : "Something went wrong loading this page. Please try again shortly.");
        else setData(body);
      } catch { setError("Something went wrong loading this page. Please try again shortly."); }
    })();
  }, [id]);

  const sign = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/done/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      if (res.ok) { setThanks(true); setData((d) => ({ ...d, signoff: { name: name.trim(), at: new Date().toISOString() } })); }
      else setError((await res.json().catch(() => ({}))).error || "Couldn't save that. Please try again.");
    } finally { setBusy(false); }
  };

  const before = (data?.photos || []).filter((p) => p.kind === "before");
  const after = (data?.photos || []).filter((p) => p.kind === "after");
  const Grid = ({ title, list }) => list.length === 0 ? null : (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13, color: "#666", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
        {list.map((p, i) => <a key={i} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={title} style={{ width: "100%", borderRadius: 8, display: "block" }} /></a>)}
      </div>
    </div>
  );

  return (
    <div style={page}>
      <div style={wrap}>
        <div style={{ fontWeight: 700, fontSize: 20 }}>Lyons Fencing &amp; Services</div>
        {error && <div style={{ ...box, color: "#C1553A" }}>{error}</div>}
        {!data && !error && <div style={box}>Loading…</div>}
        {data && (
          <div style={box}>
            <h1 style={{ margin: "0 0 4px", fontSize: 22 }}>{data.client ? `Hi ${data.client}, your fence is finished` : "Your fence is finished"}</h1>
            {data.place && <div style={{ color: "#666" }}>{data.place}</div>}
            <Grid title="Before" list={before} />
            <Grid title="After" list={after} />
            {before.length + after.length === 0 && <p style={{ color: "#666" }}>There are no photos to show yet.</p>}
            <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />
            {data.signoff ? (
              <p style={{ margin: 0 }}>{thanks ? "Thanks! " : ""}Confirmed as finished by <strong>{data.signoff.name}</strong> on {new Date(data.signoff.at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}. {thanks ? "We'll be in touch with the final invoice." : ""}</p>
            ) : (
              <>
                <p style={{ marginTop: 0 }}>Please have a look at the photos and the fence, and if you're happy the work is complete, type your name to confirm.</p>
                <input style={input} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
                <div style={{ marginTop: 12 }}><button style={{ ...btn, opacity: name.trim() && !busy ? 1 : 0.5 }} disabled={!name.trim() || busy} onClick={sign}>Confirm the work is complete</button></div>
                <p style={{ fontSize: 12.5, color: "#888", marginBottom: 0 }}>If something isn't right, please just reply to our message and we'll sort it out.</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
