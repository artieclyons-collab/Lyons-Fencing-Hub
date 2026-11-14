"use client";
// Finances panel: where leads come from (hipages, text, email) and what each source turns into: leads, quoted, won, the revenue,
// and, if you type in what a lead costs you, the spend and the cost of each win. The cost per lead is kept in one System row.
import { useMemo, useState } from "react";
import { Target } from "lucide-react";
import { money } from "@/lib/logic";
import { leadSourceStats, leadCosts, LEAD_COST_ID } from "@/lib/jobChecks";

const NAMES = { hipages: "hipages", text: "Text", email: "Email", other: "Other / not recorded" };

export default function LeadSources({ leads = [], quotes = [], expenses = [], setExpenses }) {
  const costs = useMemo(() => leadCosts(expenses), [expenses]);
  const stats = useMemo(() => leadSourceStats(leads, quotes, costs), [leads, quotes, costs]);
  const [edit, setEdit] = useState(null); // the cost being typed for "hipages"
  if (!stats.length) return null;

  const saveCost = (source, v) => {
    const next = { ...costs };
    const n = Number(String(v).replace(/[^0-9.]/g, ""));
    if (n > 0) next[source] = String(n); else delete next[source];
    setExpenses?.((es) => [{ id: LEAD_COST_ID, category: "System", description: JSON.stringify(next), amount: "0", date: new Date().toISOString().slice(0, 10) }, ...es.filter((e) => e.id !== LEAD_COST_ID)]);
    setEdit(null);
  };
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "–");

  return (
    <div className="panel">
      <div className="panel-head"><Target size={16} /><span>Where your leads come from</span></div>
      {stats.map((r) => (
        <div key={r.source} className="text-row">
          <div className="text-main">
            <div className="upcoming-name">{NAMES[r.source] || r.source} · {r.leads} {r.leads === 1 ? "lead" : "leads"}</div>
            <div className="upcoming-sub">
              {r.quoted} quoted ({pct(r.quoted, r.leads)}) · {r.won} won ({pct(r.won, r.leads)}){r.revenue ? ` · ${money(r.revenue)} accepted` : ""}
              {r.cost ? ` · ${money(r.cost)} spent${r.perWin ? ` (${money(r.perWin)} per win` : ""}${r.perWin && r.revenue ? `, ${(r.revenue / r.cost).toFixed(1)}x back)` : r.perWin ? ")" : ""}` : ""}
            </div>
            {(r.source === "hipages" || r.perLead > 0) && (
              <div className="text-actions" style={{ marginTop: 4 }}>
                {edit === r.source ? (
                  <>
                    <input className="li-desc" style={{ maxWidth: 110 }} inputMode="decimal" autoFocus placeholder="$ per lead" defaultValue={r.perLead || ""} onKeyDown={(e) => e.key === "Enter" && saveCost(r.source, e.currentTarget.value)} onBlur={(e) => saveCost(r.source, e.currentTarget.value)} />
                    <span className="calc-note" style={{ margin: 0 }}>press Enter</span>
                  </>
                ) : (
                  <button className="link-btn" onClick={() => setEdit(r.source)}>{r.perLead ? `${money(r.perLead)} per lead · change` : "What does a lead cost you? Add it to see your cost per win"}</button>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
      <p className="calc-note" style={{ marginBottom: 0 }}>Quoted and won are matched to the quotes you sent each client. Revenue is the accepted quotes inc. GST, counted once per client.</p>
    </div>
  );
}
