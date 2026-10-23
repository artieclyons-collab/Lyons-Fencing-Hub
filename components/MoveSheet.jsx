"use client";
// "Move this visit": the next two weeks, each with how it would look if the visit went there (how full the day is, how much
// driving it adds, whether it all fits), the best fits marked. One tap moves it — the new date goes straight onto the lead and
// the calendar (with an Undo) — and a text to the client asking if the new day suits is one tap away. Also: set a time on the
// same day, or let the planner pick the best day itself.
import { useState, useMemo } from "react";
import { X, Check, Send, Clock, Route } from "lucide-react";
import { addDaysIso } from "@/lib/schedule";
import { fmtClock, parseTime } from "@/lib/visitPlanner";

const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
const DAYS_AHEAD = 14;

export default function MoveSheet({ stop, lead, fromDate, today, fitFor, onMove, onTime, onAuto, onClose }) {
  const [text, setText] = useState(!!stop.phone); // text the client the new day afterwards
  const [other, setOther] = useState("");
  const [time, setTime] = useState(lead?.visitTime || "");

  const days = useMemo(() => {
    const list = [];
    for (let i = 0; i <= DAYS_AHEAD; i++) {
      const date = addDaysIso(today, i);
      if (date === fromDate || new Date(`${date}T00:00:00Z`).getUTCDay() === 0) continue; // not the day it's already on, not Sundays
      const fit = fitFor(stop.id, date);
      list.push({ date, i, fit });
    }
    // The best fits: it fits, little added strain, not much driving, and sooner rather than later.
    const rank = (d) => (d.fit?.ok && d.fit.fits ? d.fit.strain * 2 + d.fit.addedDriveMin * 0.3 + d.i * 3 : 1e6);
    const best = new Set([...list].filter((d) => d.i > 0).sort((a, b) => rank(a) - rank(b)).filter((d) => rank(d) < 1e6).slice(0, 2).map((d) => d.date));
    return list.map((d) => ({ ...d, best: best.has(d.date) }));
  }, [stop.id, fromDate, today, fitFor]);

  const busy = (fit) => {
    if (!fit || !fit.ok) return { text: "can't work this out", cls: "" };
    if (!fit.fits) return { text: `too full — last visit would run past ${fmtClock(17 * 60 + 45)}`, cls: "bad" };
    const n = fit.existing;
    const level = n === 0 ? "free day" : n <= 3 ? `${n} other visit${n === 1 ? "" : "s"}` : n <= 6 ? `busy (${n} others)` : `packed (${n} others)`;
    return { text: `${level}${fit.addedDriveMin > 0 ? ` · +${fit.addedDriveMin} min driving` : ""}`, cls: fit.strain > 40 ? "warn" : "ok" };
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Move {stop.name}</span>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="calc-note" style={{ marginTop: 0 }}>Currently on {dayLabel(fromDate)}. Tap a day to move them — it's saved straight away (with an Undo). Their booked time is cleared, since they'll need to be asked again.</p>
          {stop.phone && (
            <label className="check-row">
              <input type="checkbox" checked={text} onChange={(e) => setText(e.target.checked)} />
              <span>Then open a text to {stop.name.split(" ")[0]} asking if the new day suits</span>
            </label>
          )}

          <div className="vp-move-list">
            {days.map(({ date, fit, best }) => {
              const b = busy(fit);
              return (
                <button key={date} className={`vp-move-row ${b.cls}${best ? " best" : ""}`} onClick={() => onMove(date, text)}>
                  <strong>{dayLabel(date)}{best && <span className="vp-badge placed">best fit</span>}</strong>
                  <span>{b.text}</span>
                </button>
              );
            })}
          </div>

          <div className="vp-move-extra">
            <label className="field">
              <span>Another date</span>
              <div className="calc-trigger-row">
                <input type="date" value={other} min={today} onChange={(e) => setOther(e.target.value)} />
                <button className="btn-primary small" disabled={!other} onClick={() => onMove(other, text)}>Move</button>
              </div>
            </label>
            <label className="field">
              <span>Or keep {dayLabel(fromDate)} and set a time</span>
              <div className="calc-trigger-row">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                <button className="btn-ghost small" disabled={!parseTime(time)} onClick={() => onTime(time)}><Clock size={13} /> Set time</button>
                {lead?.visitTime && <button className="btn-ghost small" onClick={() => onTime("")}>Clear time</button>}
              </div>
            </label>
            <button className="btn-ghost small" onClick={onAuto} title="Removes their day so the planner places them on the best one itself"><Route size={13} /> Let the planner pick the best day</button>
          </div>
        </div>
      </div>
    </div>
  );
}
