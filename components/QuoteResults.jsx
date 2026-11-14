"use client";
// Finances panel: what you're winning and losing on quotes (by job type and price) and whether a quicker quote wins more.
// Maths is in lib/quoteResults.js. A quote nobody answered for 3 weeks counts as lost ("went quiet"); newer ones are "still open".
import { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { money, today } from "@/lib/logic";
import { quoteResults, speedInsight, rate, QUIET_DAYS } from "@/lib/quoteResults";

const pct = (t) => (rate(t) == null ? "–" : `${Math.round(rate(t) * 100)}%`);

function Rows({ title, rows }) {
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      {title && <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 4 }}>{title}</div>}
      {rows.map((t) => (
        <div key={t.label} style={{ padding: "7px 0", borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}>
            <span>{t.label}</span>
            <span><strong>{pct(t)}</strong> <span style={{ color: "var(--text-dim)", fontSize: 12.5 }}>won</span></span>
          </div>
          <div style={{ height: 5, background: "var(--line)", borderRadius: 3, margin: "4px 0" }}>
            <div style={{ height: 5, borderRadius: 3, background: "var(--good, #4aa56b)", width: `${Math.round((rate(t) || 0) * 100)}%` }} />
          </div>
          <div className="calc-note" style={{ margin: 0 }}>{t.sent} sent · {t.won} won · {t.lost} lost · {t.open} still open</div>
        </div>
      ))}
    </div>
  );
}

export default function QuoteResults({ leads = [], quotes = [] }) {
  const r = useMemo(() => quoteResults(leads, quotes, today()), [leads, quotes]);
  if (!r.overall.sent) return null;
  const insight = speedInsight(r.bySpeed);
  const decided = r.overall.won + r.overall.lost;
  return (
    <div className="panel">
      <div className="panel-head"><TrendingUp size={16} /><span>Quotes: what you win and lose</span></div>
      <p style={{ margin: "0 0 4px", fontSize: 14.5 }}>
        {r.overall.sent} quotes sent: <strong>{r.overall.won} won</strong> ({money(r.wonValue)}), <strong>{r.overall.lost} lost</strong> ({money(r.lostValue)}), {r.overall.open} still open.
        {decided >= 5 && <> You win <strong>{pct(r.overall)}</strong> of the ones that have an answer.</>}
      </p>
      <p className="calc-note" style={{ margin: 0 }}>Lost means declined, or no reply after {QUIET_DAYS} days. Open ones aren't counted either way yet, so the percentages firm up as they come in.</p>

      <Rows title="By job type" rows={r.byType} />
      <Rows title="By price (inc. GST)" rows={r.byPrice} />

      {r.quotedLeads > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 4 }}>How fast you get the quote out</div>
          <p style={{ margin: "0 0 4px", fontSize: 14.5 }}>
            Usually <strong>{r.median === 0 ? "the same day" : r.median === 1 ? "1 day" : `${r.median} days`}</strong> after the lead comes in (average {r.average.toFixed(1)} days, {r.quotedLeads} leads).
          </p>
          {insight && <p style={{ margin: "0 0 4px", fontSize: 14.5 }}>{insight}</p>}
          <Rows title="" rows={r.bySpeed} />
        </div>
      )}
    </div>
  );
}
