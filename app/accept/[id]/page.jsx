"use client";
// Public, unauthenticated page a client opens from a shared link to review
// and accept (or decline) a quote themselves. Access control is the same
// unguessable quote id used everywhere else in the app (no login system, per
// the brief) — fine for a small business "digital handshake", not intended
// as a cryptographic e-signature.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/storage";
import { buildDocumentHtml, DOC_CSS } from "@/lib/docHtml";
import { formatDateAU, today } from "@/lib/logic";

const pageStyle = { background: "#f4f4f2", minHeight: "100vh", padding: "24px 12px", fontFamily: "'Barlow', Arial, sans-serif" };
const wrapStyle = { maxWidth: 780, margin: "0 auto" };
const boxStyle = { background: "#fff", borderRadius: 10, padding: "20px 24px", marginTop: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", fontFamily: "inherit" };
const acceptBtnStyle = { background: "#E8B923", color: "#1C1F1D", border: "none", borderRadius: 6, padding: "10px 18px", fontWeight: 600, cursor: "pointer", fontSize: 14 };
const declineBtnStyle = { background: "transparent", color: "#C1553A", border: "1px solid #C1553A", borderRadius: 6, padding: "10px 18px", fontWeight: 600, cursor: "pointer", fontSize: 14 };

export default function AcceptQuotePage() {
  const params = useParams();
  const id = params?.id;
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) {
        setError("This link isn't connected to a database yet.");
        setLoading(false);
        return;
      }
      try {
        const { data, error: err } = await supabase.from("quotes").select("*").eq("id", id).limit(1);
        if (err) throw err;
        if (cancelled) return;
        if (!data || data.length === 0) {
          setError("We couldn't find that quote — the link may be out of date. Contact Lyons Fencing & Services directly.");
        } else {
          setQuote(data[0]);
        }
      } catch {
        if (!cancelled) setError("Something went wrong loading this quote — try again shortly.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const submit = async (status) => {
    if (status === "Accepted" && !name.trim()) return;
    setSubmitting(true);
    try {
      const updates = status === "Accepted"
        ? { status: "Accepted", acceptedAt: today(), acceptedByName: name.trim() }
        : { status: "Declined" };
      const { error: err } = await supabase.from("quotes").update(updates).eq("id", id);
      if (err) throw err;
      setQuote((q) => ({ ...q, ...updates }));
    } catch {
      setError("Couldn't submit — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div style={pageStyle}><div style={wrapStyle}>Loading…</div></div>;
  }

  if (error) {
    return <div style={pageStyle}><div style={wrapStyle}><p style={{ color: "#C1553A" }}>{error}</p></div></div>;
  }

  return (
    <div style={pageStyle}>
      <style dangerouslySetInnerHTML={{ __html: DOC_CSS }} />
      <div style={wrapStyle}>
        <div dangerouslySetInnerHTML={{ __html: buildDocumentHtml("quote", quote) }} />
        <div style={boxStyle}>
          {quote.status === "Accepted" ? (
            <p style={{ margin: 0 }}>
              {quote.acceptedByName
                ? <><strong>Accepted</strong> by {quote.acceptedByName}{quote.acceptedAt ? ` on ${formatDateAU(quote.acceptedAt)}` : ""}. Thanks — we'll be in touch to lock in a start date.</>
                : <>This quote has already been accepted.</>}
            </p>
          ) : quote.status === "Declined" ? (
            <p style={{ margin: 0 }}>This quote has been marked as declined. If that was a mistake, contact us directly.</p>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>Accept this quote</h3>
              <p style={{ color: "#5b5b5b", fontSize: 13 }}>Type your name below to accept — this confirms you're happy to go ahead on the terms above.</p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                style={inputStyle}
              />
              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <button onClick={() => submit("Accepted")} disabled={!name.trim() || submitting} style={acceptBtnStyle}>
                  {submitting ? "Submitting…" : "Accept quote"}
                </button>
                <button onClick={() => submit("Declined")} disabled={submitting} style={declineBtnStyle}>
                  Decline
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
