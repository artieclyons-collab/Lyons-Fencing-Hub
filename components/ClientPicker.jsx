"use client";
// Type a name, street or number and tap the person: their name, phone, email, address, suburb (and who it's made out to) fill the form.
import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { searchClients } from "@/lib/clientPick";

export default function ClientPicker({ options, onPick }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => searchClients(options, q), [options, q]);
  return (
    <div style={{ marginBottom: 12 }}>
      <label className="field" style={{ marginBottom: 4 }}>
        <span><Search size={12} style={{ verticalAlign: "-2px" }} /> Fill in from an existing client, lead or quote</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name, street or number…" />
      </label>
      {q.trim() && results.length === 0 && <p className="calc-note" style={{ margin: 0 }}>No one found.</p>}
      {results.map((o) => (
        <button
          type="button"
          key={o.key}
          className="btn-ghost"
          style={{ display: "block", width: "100%", textAlign: "left", marginTop: 4, whiteSpace: "normal" }}
          onClick={() => { onPick(o.fields); setQ(""); }}
        >
          <strong>{o.name}</strong> <span className="calc-note" style={{ margin: 0 }}>· {o.from.join(", ")}</span>
          {o.sub && <div className="calc-note" style={{ margin: 0 }}>{o.sub}</div>}
        </button>
      ))}
    </div>
  );
}
