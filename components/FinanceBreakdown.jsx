"use client";
// Opens from the Finances stat cards: where the income / expense / net number comes from, job by job and week by week.
import { useState } from "react";
import { X, ChevronDown, ChevronRight } from "lucide-react";
import { money } from "@/lib/logic";
import { jobAmount, weekLabel, shortDate, invoiceTotal } from "@/lib/finances";

const TITLES = {
  income: "Total income (paid, inc. GST)",
  expense: "Expenses (estimated materials, inc. GST)",
  net: "Net (income less estimated materials)",
};
const tone = (n, metric) => (metric === "expense" ? "bad" : n >= 0 ? "good" : "bad");
const signed = (n) => `${n < 0 ? "−" : ""}${money(Math.abs(n))}`;

export default function FinanceBreakdown({ metric, jobs, weeks, totals, onClose }) {
  const [view, setView] = useState("job");
  const [open, setOpen] = useState(null);
  const total = totals[metric];

  const shown = jobs
    .filter((j) => (metric === "income" ? j.paid > 0 : metric === "expense" ? j.materials > 0 : j.paid > 0 || (j.started && j.materials > 0)))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  const counted = shown.filter((j) => metric === "income" || j.started);
  const notStarted = metric === "income" ? [] : shown.filter((j) => !j.started);
  const noEstimate = metric === "income" ? [] : jobs.filter((j) => j.started && j.materials <= 0);

  const weekRows = weeks.filter((w) => (metric === "income" ? w.income > 0 : metric === "expense" ? w.expense > 0 : w.income > 0 || w.expense > 0));
  const weekValue = (w) => (metric === "income" ? w.income : metric === "expense" ? w.expense : w.net);

  const JobRow = ({ j, dim }) => {
    const isOpen = open === `j${j.key}`;
    const amt = jobAmount(j, metric);
    const value = metric === "expense" ? j.materials : amt;
    return (
      <div className="fin-item" style={dim ? { opacity: 0.6 } : undefined}>
        <div className="fin-row" onClick={() => setOpen(isOpen ? null : `j${j.key}`)}>
          {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <div className="fin-main">
            <div className="fin-title">{j.name}{j.docNumber ? <span className="fin-doc"> {j.docNumber}</span> : ""}</div>
            <div className="fin-meta">{j.address || j.jobType || "No address"}{j.lastDate ? ` · ${shortDate(j.lastDate)}` : ""}</div>
          </div>
          <div className={`fin-amt ${dim ? "" : tone(value, metric)}`}>{metric === "net" ? signed(value) : money(value)}</div>
        </div>
        {isOpen && (
          <div className="fin-detail">
            {j.quotedTotal != null && <div className="calc-row"><span>Quoted (inc. GST)</span><span>{money(j.quotedTotal)}</span></div>}
            {j.invoices.map((i) => (
              <div className="calc-row" key={i.id}>
                <span>{i.docNumber || "Invoice"} · {i.status}{i.status === "Paid" && (i.paidDate || i.issuedDate) ? ` ${shortDate(String(i.paidDate || i.issuedDate).slice(0, 10))}` : ""}</span>
                <span>{money(invoiceTotal(i))}</span>
              </div>
            ))}
            <div className="calc-row"><span>Paid so far</span><span>{money(j.paid)}</span></div>
            {j.owing > 0 && <div className="calc-row"><span>Still owing</span><span>{money(j.owing)}</span></div>}
            <div className="calc-row">
              <span>Estimated materials{j.started ? "" : " (not counted until the job starts)"}</span>
              <span>{j.materials > 0 ? money(j.materials) : "none saved"}</span>
            </div>
            {j.started && <div className="calc-row calc-row-total"><span>Paid less materials</span><span>{signed(j.paid - j.materials)}</span></div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{TITLES[metric]}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="modal-body">
          <div className={`stat-value ${tone(total, metric)}`} style={{ marginTop: 0 }}>{metric === "net" ? signed(total) : money(total)}</div>
          <p className="calc-note" style={{ marginTop: 2 }}>
            {metric === "income" && `From ${counted.length} ${counted.length === 1 ? "job" : "jobs"}. Only paid invoices count.${totals.owing > 0 ? ` A further ${money(totals.owing)} is billed but not paid yet.` : ""}`}
            {metric === "expense" && "Each job's estimated materials cost from its quote, counted from the job's start date (or when its first payment came in)."}
            {metric === "net" && "Paid income less each started job's estimated materials. Labour, fuel and tip fees aren't in here."}
          </p>

          <div className="calc-trigger-row" style={{ marginBottom: 10 }}>
            <button type="button" className={`btn-ghost small${view === "job" ? " on" : ""}`} style={view === "job" ? { borderColor: "var(--hivis)", color: "var(--hivis)" } : undefined} onClick={() => setView("job")}>By job</button>
            <button type="button" className={`btn-ghost small${view === "week" ? " on" : ""}`} style={view === "week" ? { borderColor: "var(--hivis)", color: "var(--hivis)" } : undefined} onClick={() => setView("week")}>By week</button>
          </div>

          {view === "job" && (
            <>
              {counted.length === 0 && <p className="calc-note">Nothing here yet.</p>}
              {counted.map((j) => <JobRow key={j.key} j={j} />)}
              {notStarted.length > 0 && (
                <>
                  <p className="calc-note" style={{ marginTop: 14 }}>Booked, not started yet (not counted):</p>
                  {notStarted.map((j) => <JobRow key={j.key} j={j} dim />)}
                </>
              )}
            </>
          )}

          {view === "week" && (
            <>
              {weekRows.length === 0 && <p className="calc-note">Nothing here yet.</p>}
              {weekRows.map((w) => {
                const isOpen = open === `w${w.start}`;
                const v = weekValue(w);
                return (
                  <div className="fin-item" key={w.start}>
                    <div className="fin-row" onClick={() => setOpen(isOpen ? null : `w${w.start}`)}>
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      <div className="fin-main">
                        <div className="fin-title">{weekLabel(w.start)}</div>
                        <div className="fin-meta">{metric === "net" ? `in ${money(w.income)} · materials ${money(w.expense)}` : `${new Set(w.lines.filter((l) => (metric === "income" ? l.kind === "income" : l.kind === "expense")).map((l) => l.job.key)).size} job(s)`}</div>
                      </div>
                      <div className={`fin-amt ${tone(v, metric)}`}>{metric === "net" ? signed(v) : money(v)}</div>
                    </div>
                    {isOpen && (
                      <div className="fin-detail">
                        {w.lines.filter((l) => metric === "net" || (metric === "income" ? l.kind === "income" : l.kind === "expense")).map((l, n) => (
                          <div className="calc-row" key={n}>
                            <span>{shortDate(l.date)} · {l.job.name} · {l.label}</span>
                            <span style={l.kind === "expense" ? { color: "var(--bad)" } : undefined}>{l.kind === "expense" && metric === "net" ? "−" : ""}{money(l.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {noEstimate.length > 0 && (
            <p className="calc-note" style={{ marginTop: 14 }}>
              No materials estimate is saved on {noEstimate.length === 1 ? "this started job" : `these ${noEstimate.length} started jobs`}, so {noEstimate.length === 1 ? "it counts" : "they count"} as $0: {noEstimate.map((j) => j.name + (j.docNumber ? ` ${j.docNumber}` : "")).join(", ")}. Add it on the quote (Calculate materials) and it appears here.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
