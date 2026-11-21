"use client";
// Board card: clients who were sent to you by someone, and whether that person has earned their $100 gift card yet
// (the new client's job is $1,000+ and the final invoice has been paid). Tapping "Gift card given" notes it on the lead and logs the $100 as an expense.
// The "Referred by" line comes from the client's text or email, or you can add it on any lead below. See lib/referrals.js.
import { useMemo, useState } from "react";
import { Gift, Check, FileText, Plus } from "lucide-react";
import { referralRewards, markRewardGiven, setReferredBy, referredBy, REFERRAL_REWARD, REFERRAL_MIN_JOB, REFERRAL_EXPENSE_PREFIX } from "@/lib/referrals";
import { money, today } from "@/lib/logic";

const dayLabel = () => new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short" });

export default function Referrals({ leads = [], quotes = [], invoices = [], setLeads, setExpenses, go }) {
  const rows = useMemo(() => referralRewards(leads, quotes, invoices), [leads, quotes, invoices]);
  const [adding, setAdding] = useState(false);
  const [leadId, setLeadId] = useState("");
  const [who, setWho] = useState("");
  const live = rows.filter((r) => ["owed", "waiting", "quoted"].includes(r.state));
  const owed = rows.filter((r) => r.state === "owed");
  const candidates = useMemo(() => leads.filter((l) => !referredBy(l.notes) && l.status !== "Lost").slice(0, 400), [leads]);

  const give = ({ lead, referrer }) => {
    setLeads?.((ls) => ls.map((l) => (l.id === lead.id ? { ...l, notes: markRewardGiven(l.notes, dayLabel()) } : l)));
    setExpenses?.((es) => [{ id: `${REFERRAL_EXPENSE_PREFIX}${lead.id}`, category: "Other", description: `Referral gift card: ${referrer} (referred ${lead.name})`, amount: String(REFERRAL_REWARD), date: today() }, ...es.filter((e) => e.id !== `${REFERRAL_EXPENSE_PREFIX}${lead.id}`)]);
  };
  const add = () => {
    if (!leadId || !who.trim()) return;
    setLeads?.((ls) => ls.map((l) => (l.id === leadId ? { ...l, notes: setReferredBy(l.notes, who) } : l)));
    setAdding(false); setLeadId(""); setWho("");
  };

  if (!live.length && !adding) {
    // nothing on the go: just a small link, so the Board isn't cluttered
    return (
      <p className="calc-note" style={{ margin: "4px 0" }}>
        <button type="button" className="link-btn" onClick={() => setAdding(true)} title={`A referrer earns a $${REFERRAL_REWARD} gift card once the new client's final invoice (job $${REFERRAL_MIN_JOB.toLocaleString()}+) is paid`}><Gift size={13} /> Add a referral</button>
      </p>
    );
  }
  return (
    <div className="panel" style={owed.length ? { borderColor: "var(--good, #3a9a5b)" } : undefined}>
      <div className="panel-head"><Gift size={16} /><span>{owed.length ? `Referral rewards to give (${owed.length})` : "Referrals"}</span></div>
      {live.map((r) => (
        <div key={r.lead.id} className="text-row">
          <div className="upcoming-date">{r.state === "owed" ? "Due" : r.state === "waiting" ? "Soon" : "Quoted"}</div>
          <div className="text-main">
            <div className="upcoming-name">{r.referrer} <span className="calc-note" style={{ margin: 0 }}>referred {r.lead.name}</span></div>
            <div className="upcoming-sub">{r.why}{r.jobTotal ? ` · job ${money(r.jobTotal)}` : ""}</div>
            <div className="text-actions">
              {r.state === "owed" && <button className="btn-primary small" onClick={() => give(r)}><Check size={13} /> ${REFERRAL_REWARD} gift card given</button>}
              <button className="btn-ghost small" onClick={() => go?.("leads", { open: { table: "leads", id: r.lead.id } })}><FileText size={13} /> Open lead</button>
            </div>
          </div>
        </div>
      ))}
      {adding ? (
        <div className="line-item" style={{ marginTop: 8 }}>
          <select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">Who was referred…</option>
            {candidates.map((l) => <option key={l.id} value={l.id}>{l.name}{l.address ? ` · ${l.address}` : ""}</option>)}
          </select>
          <input placeholder="Referred by (name)" value={who} onChange={(e) => setWho(e.target.value)} />
          <button className="btn-primary small" onClick={add} disabled={!leadId || !who.trim()}><Check size={13} /> Add</button>
          <button className="btn-ghost small" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn-ghost small" style={{ marginTop: 8 }} onClick={() => setAdding(true)}><Plus size={13} /> Add a referral</button>
      )}
    </div>
  );
}
