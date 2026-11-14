"use client";
// Finances panel: the estimated profit on each job (price, less the materials, less Usher's labour), with the margin, plus the average margin by
// job type. The working is in lib/jobProfit.js.
import { useMemo, useState } from "react";
import { PiggyBank } from "lucide-react";
import { money } from "@/lib/logic";
import { jobProfits, profitTotals, profitByType } from "@/lib/jobProfit";

const SHOW = 6;
const pct = (m) => (m == null ? "–" : `${Math.round(m * 100)}%`);
const signed = (n) => `${n < 0 ? "−" : ""}${money(Math.abs(n))}`;

export default function JobProfit({ jobs = [] }) {
  const rows = useMemo(() => jobProfits(jobs), [jobs]);
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
        {totals.count} {totals.count === 1 ? "job" : "jobs"} with materials: <strong>{signed(totals.profit)} profit</strong> ({pct(totals.margin)}) on {money(totals.price)} of work, after {money(totals.materials)} materials and {money(totals.labour)} labour.
      </p>
      {totals.skipped > 0 && <p className="calc-note" style={{ margin: "0 0 4px" }}>{totals.skipped} {totals.skipped === 1 ? "job has" : "jobs have"} no materials figure yet, so {totals.skipped === 1 ? "it's" : "they're"} left out of these totals (open the quote and use Calculate materials, or add the supplier invoice).</p>}
      <p className="calc-note" style={{ margin: 0 }}>Ex GST. Price less the calculated materials (or the real supplier invoices once added) and Usher's invoices. Fuel, tip fees and your own time aren't taken off. Where Usher hasn't invoiced a job yet, the quote's own labour figure stands in and is marked "est.".</p>

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
              Price {money(r.price)} · materials {money(r.materials)} ({r.materialsFrom}) · labour {money(r.labour)} ({r.labourFrom}){r.started ? "" : " · not started"}
            </div>
          </div>
        ))}
        {rows.length > SHOW && <button className="link-btn" style={{ marginTop: 8 }} onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show ${rows.length - SHOW} more`}</button>}
      </div>
    </div>
  );
}
