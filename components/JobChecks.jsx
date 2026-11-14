"use client";
// Board panel: (1) Colorbond jobs that are about to start with no colour confirmed, (2) the 24-month warranty on finished jobs.
// The colour is stored as a small System row in the expenses table (see lib/jobChecks.js), so nothing needs adding to the database.
import { useMemo, useState } from "react";
import { Palette, ShieldCheck, Send, Check } from "lucide-react";
import { today } from "@/lib/logic";
import { smsLink, firstName } from "@/lib/introText";
import { colourChecks, colourMap, warrantyList, COLOUR_PREFIX, WARRANTY_SOON_DAYS } from "@/lib/jobChecks";

const SHOW_WARRANTY = 5;
const nice = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }); };
const inDays = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n > 1 ? `in ${n} days` : n === -1 ? "yesterday" : `${-n} days ago`);

export default function JobChecks({ quotes = [], invoices = [], expenses = [], setExpenses }) {
  const todayIso = today();
  const colours = useMemo(() => colourMap(expenses), [expenses]);
  const checks = useMemo(() => colourChecks(quotes, invoices, colours, todayIso), [quotes, invoices, colours, todayIso]);
  const warranty = useMemo(() => warrantyList(quotes, invoices, todayIso), [quotes, invoices, todayIso]);
  const [typed, setTyped] = useState({});
  const [showAllWarranty, setShowAllWarranty] = useState(false);

  const saveColour = (quoteId, colour) => {
    const id = COLOUR_PREFIX + quoteId;
    const c = String(colour || "").trim();
    setExpenses?.((es) => {
      const rest = es.filter((e) => e.id !== id);
      return c ? [{ id, category: "System", description: c, amount: "0", date: todayIso }, ...rest] : rest;
    });
    setTyped((t) => ({ ...t, [quoteId]: "" }));
  };
  const askColour = (q) => {
    const body = `Hi ${firstName(q.clientName)},\n\nQuick question before we start${q.startDate ? ` on ${nice(q.startDate)}` : ""}: which Colorbond colour would you like for your fence?\n\nCheers,\nArtie`;
    window.location.href = smsLink(q.clientPhone, body);
  };
  const checkIn = (w) => {
    const body = `Hi ${firstName(w.name)},\n\nJust a quick check-in. Your fence${w.address ? ` at ${w.address}` : ""} is still under our 24-month warranty until ${nice(w.ends)}. If you've noticed anything, let me know and I'll come and have a look.\n\nCheers,\nArtie`;
    window.location.href = smsLink(w.phone, body);
  };

  const soon = warranty.filter((w) => w.daysLeft <= WARRANTY_SOON_DAYS);
  const later = warranty.filter((w) => w.daysLeft > WARRANTY_SOON_DAYS);
  const shownLater = showAllWarranty ? later : later.slice(0, SHOW_WARRANTY);
  if (!checks.length && !warranty.length) return null;

  return (
    <div className="panel">
      {checks.length > 0 && (
        <>
          <div className="panel-head"><Palette size={16} /><span>Colorbond colour ({checks.filter((c) => !c.colour).length} to confirm)</span></div>
          {checks.map(({ quote: q, colour, days, urgent }) => (
            <div key={q.id} className="text-row">
              <div className="upcoming-date" style={urgent ? { color: "var(--bad)" } : undefined}>{inDays(days).replace("in ", "").replace(" days", "d")}</div>
              <div className="text-main">
                <div className="upcoming-name">{q.clientName || "Client"}</div>
                <div className="upcoming-sub">{q.address || q.jobType} · starts {q.startDate ? nice(q.startDate) : "soon"} ({inDays(days)})</div>
                {colour ? (
                  <div className="text-actions">
                    <span className="calc-note" style={{ margin: 0, color: "var(--good)" }}><Check size={12} style={{ verticalAlign: "-2px" }} /> Colour confirmed: <strong>{colour}</strong></span>
                    <button className="btn-ghost small" onClick={() => saveColour(q.id, "")}>Change</button>
                  </div>
                ) : (
                  <div className="text-actions">
                    <input className="li-desc" style={{ maxWidth: 170 }} placeholder="Colour, e.g. Monument" value={typed[q.id] || ""} onChange={(e) => setTyped((t) => ({ ...t, [q.id]: e.target.value }))} />
                    <button className="btn-primary small" disabled={!(typed[q.id] || "").trim()} onClick={() => saveColour(q.id, typed[q.id])}><Check size={13} /> Confirmed</button>
                    {q.clientPhone && <button className="btn-ghost small" onClick={() => askColour(q)}><Send size={13} /> Ask them</button>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {warranty.length > 0 && (
        <>
          <div className="panel-head" style={checks.length ? { marginTop: 16 } : undefined}><ShieldCheck size={16} /><span>Warranty ({warranty.length} {warranty.length === 1 ? "job" : "jobs"} covered)</span></div>
          {soon.length === 0 && <p className="calc-note" style={{ margin: "0 0 6px" }}>Nothing ending in the next {WARRANTY_SOON_DAYS} days.</p>}
          {[...soon, ...shownLater].map((w) => (
            <div key={w.key} className="text-row">
              <div className="upcoming-date" style={w.daysLeft <= WARRANTY_SOON_DAYS ? { color: "var(--warn, #c9873a)" } : undefined}>{w.daysLeft < 0 ? "ended" : `${w.daysLeft}d`}</div>
              <div className="text-main">
                <div className="upcoming-name">{w.name}</div>
                <div className="upcoming-sub">{w.address ? `${w.address} · ` : ""}finished {nice(w.finished)} · covered until {nice(w.ends)}</div>
                {w.daysLeft <= WARRANTY_SOON_DAYS && w.daysLeft >= -30 && w.phone && (
                  <div className="text-actions"><button className="btn-ghost small" onClick={() => checkIn(w)}><Send size={13} /> Text a check-in</button></div>
                )}
              </div>
            </div>
          ))}
          {later.length > SHOW_WARRANTY && (
            <button className="link-btn" style={{ marginTop: 8 }} onClick={() => setShowAllWarranty((v) => !v)}>{showAllWarranty ? "Show fewer" : `Show ${later.length - SHOW_WARRANTY} more`}</button>
          )}
        </>
      )}
    </div>
  );
}
