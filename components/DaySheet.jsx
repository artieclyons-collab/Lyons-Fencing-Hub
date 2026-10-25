"use client";
// "Today / Tomorrow" on the Board: everything for one day in one place — the weather, each job (where, how long,
// who to call) and each quote visit in time order — with directions and a copy-as-text button.
// It reads the same schedule the Board calendar and iPhone feed use, so it can't disagree with them.
import { useState, useEffect } from "react";
import { Sun, Cloud, CloudSun, CloudFog, CloudDrizzle, CloudRain, CloudLightning, Hammer, Users, Navigation, Phone, Copy, Check, Route, FileText } from "lucide-react";
import { addDaysIso } from "@/lib/schedule";
import { hoursLabel } from "@/lib/jobSchedule";
import { rainLevel, weatherIcon, RAIN_LABEL } from "@/lib/weather";
import { hasQuote, quoteTag } from "@/lib/leadQuotes";

const ICONS = { sun: Sun, partly: CloudSun, cloud: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, storm: CloudLightning };
const mapsTo = (address) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;

const clock = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}${m[2] === "00" ? "" : `:${m[2]}`}${h < 12 ? "am" : "pm"}`;
};
const longDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
const localToday = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the device's time zone
const place = (o) => [o.address, o.suburb].filter(Boolean).join(", ");
const clip = (s, n = 160) => (s && s.length > n ? `${s.slice(0, n)}…` : s || "");

export default function DaySheet({ events, quotes, leads, forecast, go }) {
  const t = localToday();
  const tomorrow = addDaysIso(t, 1);
  // From mid-afternoon the useful question is "what's tomorrow?"; before that it's today.
  const [which, setWhich] = useState("today");
  useEffect(() => { if (new Date().getHours() >= 15) setWhich("tomorrow"); }, []);
  const [copied, setCopied] = useState(false);
  const date = which === "today" ? t : tomorrow;

  const day = events.filter((e) => e.date === date && (e.kind === "job" || e.kind === "visit"));
  const jobs = day.filter((e) => e.kind === "job").map((e) => ({ e, q: quotes.find((q) => q.id === e.ref?.id) || {} }));
  const visits = day
    .filter((e) => e.kind === "visit")
    .map((e) => ({ e, l: leads.find((l) => l.id === e.ref?.id) || {} }))
    .sort((a, b) => (a.e.time || "99:99").localeCompare(b.e.time || "99:99"));
  const wx = (forecast || []).find((d) => d.date === date);
  const level = wx ? rainLevel(wx.rainMm) : null;
  const WxIcon = wx ? ICONS[weatherIcon(wx.code)] || Cloud : null;
  const wxText = wx
    ? `${RAIN_LABEL[level]}${wx.chance != null ? ` · ${wx.chance}% chance` : ""}${wx.rainMm >= 1 ? ` · ${Math.round(wx.rainMm)}mm` : ""} · max ${Math.round(wx.maxTemp)}°${wx.gust >= 40 ? ` · gusts ${Math.round(wx.gust)}km/h` : ""}`
    : "";

  const asText = () => {
    const lines = [`${which === "today" ? "Today" : "Tomorrow"} — ${longDay(date)}`];
    if (wxText) lines.push(`Weather: ${wxText}`);
    for (const { e, q } of jobs) {
      lines.push("", `JOB: ${e.name} — ${[q.jobType, e.hours ? hoursLabel(e.hours) : ""].filter(Boolean).join(", ")}`, place(q) || e.location || "");
      if (q.clientPhone) lines.push(q.clientPhone);
    }
    if (visits.length) lines.push("", "QUOTE VISITS:");
    for (const { e, l } of visits) lines.push(`${e.time ? clock(e.time) : "no time set"}  ${e.name}${l.jobType ? ` (${l.jobType})` : ""} — ${l.address || e.location || ""}${l.phone ? ` · ${l.phone}` : ""}`);
    return lines.filter((x, i, a) => !(x === "" && (i === 0 || a[i - 1] === ""))).join("\n");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {}
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <Sun size={16} />
        <span>{which === "today" ? "Today" : "Tomorrow"}</span>
        <div className="vp-seg" style={{ marginLeft: "auto" }}>
          <button className={which === "today" ? "on" : ""} onClick={() => setWhich("today")}>Today</button>
          <button className={which === "tomorrow" ? "on" : ""} onClick={() => setWhich("tomorrow")}>Tomorrow</button>
        </div>
      </div>
      <div className="ds-date">{longDay(date)}</div>

      {wx && (
        <div className={`ds-weather ${level}`}>
          <WxIcon size={16} /> {wxText}
          {(level === "heavy" || level === "wet") && jobs.length > 0 && <strong> — wet for a job day</strong>}
        </div>
      )}

      {jobs.length === 0 && visits.length === 0 && <p className="calc-note" style={{ margin: "8px 0 0" }}>Nothing booked. Job start dates and quote visits show up here.</p>}

      {jobs.map(({ e, q }) => (
        <div key={e.uid} className="ds-item job">
          <div className="ds-icon"><Hammer size={16} /></div>
          <div className="ds-main">
            <div className="ds-title">{e.name}<span>{e.label}</span></div>
            <div className="ds-sub">{[q.jobType, e.hours ? hoursLabel(e.hours) : ""].filter(Boolean).join(" · ")}</div>
            {(place(q) || e.location) && <div className="ds-addr">{place(q) || e.location}</div>}
            {q.notes && <div className="ds-notes">{clip(q.notes)}</div>}
            <div className="vp-actions">
              {(place(q) || e.location) && <a className="btn-ghost small" href={mapsTo(place(q) || e.location)} target="_blank" rel="noreferrer"><Navigation size={13} /> Directions</a>}
              {q.clientPhone && <a className="btn-ghost small" href={`tel:${q.clientPhone}`}><Phone size={13} /> Call</a>}
            </div>
          </div>
        </div>
      ))}

      {visits.map(({ e, l }) => (
        <div key={e.uid} className="ds-item visit">
          <div className="ds-icon"><Users size={16} /></div>
          <div className="ds-main">
            <div className="ds-title">{e.time ? <strong className="ds-time">{clock(e.time)}</strong> : <span className="ds-time dim">no time</span>} {e.name}{l.jobType ? <span>{l.jobType}</span> : null}</div>
            {(l.address || e.location) && <div className="ds-addr">{l.address || e.location}</div>}
            <div className="vp-actions">
              {(l.address || e.location) && <a className="btn-ghost small" href={mapsTo(l.address || e.location)} target="_blank" rel="noreferrer"><Navigation size={13} /> Directions</a>}
              {l.phone && <a className="btn-ghost small" href={`tel:${l.phone}`}><Phone size={13} /> Call</a>}
              {l.id && ["New", "Contacted"].includes(l.status) && (hasQuote(l, quotes)
                ? <span className="calc-note" style={{ margin: 0 }}>{quoteTag(l, quotes)}</span>
                : <button className="btn-ghost small" onClick={() => go("quotes", { newFromLead: l })}><FileText size={13} /> Start quote</button>)}
            </div>
          </div>
        </div>
      ))}

      {(jobs.length > 0 || visits.length > 0) && (
        <div className="calc-trigger-row" style={{ marginTop: 12 }}>
          <button className="btn-ghost small" onClick={copy}>{copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy as text</>}</button>
          {visits.length > 1 && <button className="btn-ghost small" onClick={() => go("visits")}><Route size={13} /> Plan the best order</button>}
        </div>
      )}
    </div>
  );
}
