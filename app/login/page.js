"use client";
import { useState } from "react";

const safeNext = (n) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/");

export default function Login() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Couldn't sign in");
        setBusy(false);
        return;
      }
      window.location.replace(safeNext(new URLSearchParams(window.location.search).get("next")));
    } catch {
      setError("Couldn't reach the hub. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div className="app" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form onSubmit={submit} className="panel" style={{ width: "100%", maxWidth: 360, marginBottom: 0 }}>
        <div style={{ textAlign: "center", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 26, letterSpacing: 0.5, color: "var(--hivis)", margin: "2px 0 2px" }}>LYONS FENCING</div>
        <div className="panel-head" style={{ justifyContent: "center", marginBottom: 16 }}>Business hub</div>
        <input type="text" name="username" autoComplete="username" defaultValue="Lyons Fencing Hub" style={{ display: "none" }} readOnly />
        <label className="field">
          <span>Password</span>
          <input type="password" name="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="calc-note" style={{ color: "var(--bad)", marginTop: 0 }}>{error}</p>}
        <button type="submit" className="btn-primary" disabled={!password || busy} style={{ width: "100%", justifyContent: "center" }}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
