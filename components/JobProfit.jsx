"use client";
// Finances panel: the estimated profit on each job (price, less the materials, less Usher's labour), with the margin, plus the average margin by
// job type. The working is in lib/jobProfit.js.
import { useEffect, useMemo, useState } from "react";
import { PiggyBank } from "lucide-react";
import { money } from "@/lib/logic";
import { jobProfits, profitTotals, profitByType, routeKmMap, ROUTE_KM_ID } from "@/lib/jobProfit";
import { estimateRouteDistance } from "@/lib/ai";

const SHOW = 6;
const pct = (m) => (m == null ? "–" : `${Math.round(m * 100)}%`);
const signed = (n) => `${n < 0 ? "−" : ""}${money(Math.abs(n))}`;

export default function JobProfit({ jobs = [], settings, expenses = [], setExpenses }) {
  // A quote with no distance on it gets one worked out from its address (the same lookup as the quote screen's route estimate), once.
  // It's remembered in one small System row (so every device and "Ask the hub" use the same figure) and only used for the fuel estimate here;
  // nothing is written to the quote itself.
  const kms = useMemo(() => routeKmMap(expenses), [expenses]);
  const need = useMemo(() => jobs.filter((j) => j.quote && !(Number(j.quote.distanceKm) > 0) && String(j.quote.address || "").trim() && kms[j.quote.id] === undefined).map((j) => j.quote), [jobs, kms]);
  useEffect(() => {
    if (!need.length) return undefined;
    let stop = false;
    (async () => {
      for (const q of need.slice(0, 15)) {
        if (stop) return;
        let km = 0;
        try { km = Number(await estimateRouteDistance([q.address, q.suburb].filter(Boolean).join(", "), q.jobType)) || 0; } catch { km = 0; }
        if (stop) return;
        setExpenses?.((es) => [{ id: ROUTE_KM_ID, category: "System", description: JSON.stringify({ ...routeKmMap(es), [q.id]: km }), amount: "0", date: new Date().toISOString().slice(0, 10) }, ...es.filter((e) => e.id !== ROUTE_KM_ID)]);
        await new Promise((r) => setTimeout(r, 1500)); // the map lookup asks for about a second between addresses
      }
    })();
    return () => { stop = true; };
  }, [need.map((q) => q.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => jobProfits(jobs, settings, kms), [jobs, settings, kms]);
  const totals = useMemo(() => profitTotals(rows), [rows]);
  const types = useMemo(() => profitByType(rows), [rows]);
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, SHOW);
  if (!totals.count && !totals.skipped) return null;

  return (
    <div className="panel">
      <div className="panel-head"><PiggyBank size={16} /><span>Profit by job (estimate)</span></div>
      <p style={{ margin: "0 0 4px", fontSize: 14.5 }}>
        {totals.count} {totals.count === 1 ? "job" : "jobs"} with materials: <strong>{signed(totals.profit)} profit</strong> ({pct(totals.margin)}) on {money(totals.price)} of work, after {money(totals.materials)} materials, {money(totals.labour)} labour, {money(totals.fuel)} fuel and {money(totals.tip)} tip fees.
      </p>
      {totals.skipped > 0 && <p className="calc-note" style={{ margin: "0 0 4px" }}>{totals.skipped} {totals.skipped === 1 ? "job has" : "jobs have"} no materials figure yet, so {totals.skipped === 1 ? "it's" : "they're"} left out of these totals (open the quote and use Calculate materials, or add the supplier invoice).</p>}
      <p className="calc-note" style={{ margin: 0 }}>Ex GST. Price less the calculated materials (or the real supplier invoices once added), Usher's invoices, and each quote's fuel and tip fee estimates. Your own time isn't taken off. Fuel is the quote's driving distance (worked out from the address when the quote has none) at your fuel price and consumption. Where Usher hasn't invoiced a job yet, the quote's own labour figure stands in and is marked "est.".</p>

      {types.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 4 }}>Average margin by job type</div>
          {types.map((t) => (
            <div key={t.type} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderTop: "1px solid var(--line)", fontSize: 14 }}>
              <span>{t.type} <span className="calc-note" style={{ margin: 0 }}>({t.count})</span></span>
              <span><strong>{pct(t.margin)}</strong> <span className="calc-note" style={{ margin: 0 }}>{signed(t.profit)}</span></span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 4 }}>Job by job</div>
        {shown.map((r) => (
          <div key={r.key} style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}>
              <span>{r.name}{r.address ? <span className="calc-note" style={{ margin: "0 0 0 6px" }}>{r.address}</span> : null}</span>
              {r.incomplete ? <span className="calc-note" style={{ margin: 0, whiteSpace: "nowrap" }}>no materials yet</span> : <span style={{ whiteSpace: "nowrap", color: r.profit < 0 ? "var(--bad)" : undefined }}><strong>{signed(r.profit)}</strong> <span className="calc-note" style={{ margin: 0 }}>{pct(r.margin)}</span></span>}
            </div>
            <div className="calc-note" style={{ margin: 0 }}>
              Price {money(r.price)} · materials {money(r.materials)} ({r.materialsFrom}) · labour {money(r.labour)} ({r.labourFrom}) · fuel {r.noDistance ? "not set" : money(r.fuel)} · tip {money(r.tip)}{r.started ? "" : " · not started"}
            </div>
          </div>
        ))}
        {rows.length > SHOW && <button className="link-btn" style={{ marginTop: 8 }} onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show ${rows.length - SHOW} more`}</button>}
      </div>
    </div>
  );
}
