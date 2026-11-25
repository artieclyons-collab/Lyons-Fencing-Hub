"use client";
// Board card: clients who wrote back with something that needs an answer (the hub spots it in their text or email and puts "Needs a reply" on their lead).
// It stays here, and the phone is nudged every few hours, until you tap Replied. See lib/needsReply.js.
import { useMemo } from "react";
import { MessageCircleQuestion, Check, FileText, Phone } from "lucide-react";
import { needsReply, markReplied } from "@/lib/needsReply";
import { smsLink } from "@/lib/introText";

export default function NeedsReply({ leads = [], setLeads, go }) {
  const waiting = useMemo(() => leads.map((l) => ({ l, n: needsReply(l.notes) })).filter((x) => x.n), [leads]);
  if (!waiting.length) return null;
  const done = (id) => setLeads?.((rows) => rows.map((l) => (l.id === id ? { ...l, notes: markReplied(l.notes, new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short" })) } : l)));
  return (
    <div className="panel" style={{ borderColor: "var(--warn, #c9873a)" }}>
      <div className="panel-head"><MessageCircleQuestion size={16} /><span>Waiting on your reply ({waiting.length})</span></div>
      {waiting.map(({ l, n }) => (
        <div key={l.id} className="text-row">
          <div className="upcoming-date">{n.when}</div>
          <div className="text-main">
            <div className="upcoming-name">{l.name}</div>
            <div className="upcoming-sub">{n.summary}</div>
            <div className="text-actions">
              <button className="btn-primary small" onClick={() => done(l.id)}><Check size={13} /> Replied</button>
              {l.phone && <a className="btn-ghost small" href={smsLink(l.phone, "")} onClick={() => done(l.id)} title="Opens Messages and counts as replied"><Phone size={13} /> Text</a>}
              <button className="btn-ghost small" onClick={() => go("leads", { open: { table: "leads", id: l.id } })}><FileText size={13} /> Open lead</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
