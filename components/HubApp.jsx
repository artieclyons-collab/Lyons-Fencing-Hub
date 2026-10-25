"use client";
// Ported from the original Claude artifact (lyons-fencing-hub.jsx).
// Component structure and behaviour are unchanged — only the storage layer
// (Supabase instead of window.storage), the AI calls (server routes instead of
// direct API calls) and the document download (real PDF endpoint) differ.
import { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutGrid, Users, FileText, Receipt, Boxes, Wallet,
  Plus, X, Phone, MapPin, Trash2, ChevronRight,
  AlertTriangle, TrendingUp, TrendingDown, Check, Fuel, Settings, ClipboardPaste, Camera, CalendarDays, UserCircle, Download,
  ShoppingCart, Share2, Copy, Hammer, Clock, Search, Droplets, Sun, Cloud, CloudSun, CloudFog, CloudDrizzle, CloudRain, CloudLightning,
  Route, Navigation, Lock, Unlock, Car, Map as MapIcon, Send, Smartphone, Undo2, Mail, GripVertical,
} from "lucide-react";

import {
  JOB_TYPES, LEAD_STATUSES, QUOTE_STATUSES, INVOICE_STATUSES, EXPENSE_CATEGORIES,
  NOTE_SNIPPETS, JOB_TEMPLATES, PRESET_MATERIALS, LABOUR_RATES, statusColor,
} from "@/lib/constants";
import {
  uid, money, today, itemsTotal, gstBreakdown, addMonths, formatDateAU,
  buildFilename, suggestedNotes, SLEEPER_NOTE, calcMaterials, colorbondBays, aluminiumLayout, templateMaterialsCost, estFuelCost,
  isDepositInvoice, DEPOSIT_DUE_NOTE,
} from "@/lib/logic";
import { usePersistedList, usePersistedValue, usingSupabase } from "@/lib/storage";
import { lookupPrice, scanJobPhoto, estimateRouteDistance } from "@/lib/ai";
import { lookupSuburb } from "@/lib/geocode";
import { scheduleEvents, addDaysIso } from "@/lib/schedule";
import {
  estimateHours, hoursLabel, jobDays, suggestSchedule, dayLoads, worksSaturday, isWorkDay, isIsoDate, HOURS_PER_DAY, shiftWorkDays,
} from "@/lib/jobSchedule";
import { rainLevel, isWetDay, wetDates, weatherIcon, RAIN_LABEL, WEATHER_LOCATION } from "@/lib/weather";
import { matchesQuery, quoteText, invoiceText, leadText } from "@/lib/search";
import TextsToSend from "./TextsToSend";
import IntroTextModal from "./IntroTextModal";
import { needsIntro } from "@/lib/introText";
import EmailModal from "./EmailModal";
import MoveSheet from "./MoveSheet";
import { useVisitDrag } from "./useVisitDrag";
import DaySheet from "./DaySheet";
import { quoteFromLead } from "@/lib/leadToQuote";
import { collectVisits, collectJobDays, HOME, WORK_START } from "@/lib/visitData";
import { buildNodes, runPlan } from "@/lib/visitRun";
import { PLACES, fmtClock, fmtHHMM, parseTime, TRAFFIC_FACTOR } from "@/lib/visitPlanner";
import { parseAvailability, parseDay, withAvailability, parseNotesAvailability, cancellationHint, rescheduleHint, ownNotes } from "@/lib/availability";
import { parseSiteNotes } from "@/lib/siteNotes";
import { adjustForDimensions, materialsInputs } from "@/lib/quoteAdjust";
import { parseReceipt } from "@/lib/receipt";
import { extractAddress } from "@/lib/enquiry";
import { readReceipt } from "@/lib/ocr";
import { buildDocumentHtml, DOC_CSS } from "@/lib/docHtml";

// ---------- shared UI ----------
function Tag({ label }) {
  const c = statusColor[label] || "#7C8B85";
  return (
    <span className="tag" style={{ borderColor: c, color: c }}>
      {label}
    </span>
  );
}

function EmptyState({ icon: Icon, title, hint, onAdd, addLabel }) {
  return (
    <div className="empty">
      <Icon size={28} strokeWidth={1.5} />
      <div className="empty-title">{title}</div>
      <div className="empty-hint">{hint}</div>
      {onAdd && (
        <button className="btn-primary" onClick={onAdd}>
          <Plus size={16} /> {addLabel}
        </button>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

// ---------- Dashboard ----------
const EVENT_KINDS = {
  job: { icon: Hammer, cls: "kind-job" },
  visit: { icon: MapPin, cls: "kind-visit" },
  followup: { icon: Phone, cls: "kind-followup" },
  invoice: { icon: Receipt, cls: "kind-invoice" },
};

// "09:30" -> "9:30am"
const fmtTime = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};

function dayHeading(iso) {
  const d = new Date(`${iso}T00:00:00`);
  const short = d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  if (iso === today()) return { main: "Today", sub: short, isToday: true };
  if (iso === addDaysIso(today(), 1)) return { main: "Tomorrow", sub: short };
  return { main: d.toLocaleDateString("en-AU", { weekday: "long" }), sub: short };
}

// Month calendar for the Board. Shows everything from lib/schedule.js (the same list the iPhone calendar
// feed uses); tap a day to see it, and change a job / visit / invoice date right there.
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthCells(ym) {
  const first = `${ym}-01`;
  const [y, m] = ym.split("-").map(Number);
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const rows = Math.ceil((offset + daysInMonth) / 7);
  return Array.from({ length: rows * 7 }, (_, i) => {
    const date = addDaysIso(first, i - offset);
    return { date, inMonth: date.slice(0, 7) === ym, day: Number(date.slice(8)) };
  });
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const WEATHER_ICONS = { sun: Sun, partly: CloudSun, cloud: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, storm: CloudLightning };
const mmText = (mm) => (Number(mm) < 0.1 ? "dry" : `${Number(mm) >= 10 ? Math.round(mm) : Math.round(mm * 10) / 10}mm`);

// Rain outlook: next ~2 weeks, wet days tinted, with a flag for any booked job that lands on one.
function WeatherPanel({ forecast, error, jobsByDate, onPushBack }) {
  const days = forecast || [];
  const wetJobDays = days.filter((d) => isWetDay(d) && (jobsByDate[d.date] || []).length > 0);
  return (
    <div className="panel">
      <div className="panel-head">
        <CloudRain size={16} />
        <span>Rain outlook — {WEATHER_LOCATION.name}</span>
      </div>
      {error && <p className="calc-note" style={{ margin: 0 }}>Couldn't load the forecast ({error}). The rest of the Board still works.</p>}
      {!forecast && !error && <p className="calc-note" style={{ margin: 0 }}>Loading forecast…</p>}
      {days.length > 0 && (
        <div className="wx-strip">
          {days.map((d) => {
            const level = rainLevel(d.rainMm);
            const Icon = WEATHER_ICONS[weatherIcon(d.code)];
            const date = new Date(`${d.date}T00:00:00`);
            const jobs = jobsByDate[d.date] || [];
            return (
              <div key={d.date} className={`wx-day wx-${level}${d.date === today() ? " wx-today" : ""}`} title={`${RAIN_LABEL[level]} · ${mmText(d.rainMm)}${d.chance != null ? ` · ${d.chance}% chance` : ""} · gusts ${Math.round(d.gust)} km/h`}>
                <div className="wx-dow">{d.date === today() ? "Today" : date.toLocaleDateString("en-AU", { weekday: "short" })}</div>
                <div className="wx-date">{date.getDate()}</div>
                <Icon size={20} />
                <div className="wx-mm">{mmText(d.rainMm)}</div>
                <div className="wx-chance">{d.chance != null ? `${d.chance}%` : ""}</div>
                {jobs.length > 0 && <div className="wx-job" title={jobs.join(", ")}><Hammer size={11} /> {jobs.length}</div>}
              </div>
            );
          })}
        </div>
      )}
      {wetJobDays.length > 0 && (
        <div className="over-warning wx-warn">
          <CloudRain size={14} />
          <span>
            Rain on job days:{" "}
            {wetJobDays.slice(0, 4).map((d, i) => (
              <span key={d.date}>{i > 0 ? "; " : ""}<strong>{(jobsByDate[d.date] || []).join(", ")}</strong> {new Date(`${d.date}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })} ({mmText(d.rainMm)})</span>
            ))}
            {wetJobDays.length > 4 ? ` +${wetJobDays.length - 4} more` : ""}
          </span>
          <button className="btn-ghost small" onClick={onPushBack}>Push jobs back…</button>
        </div>
      )}
      <p className="calc-note" style={{ marginBottom: 0 }}>
        Heavy = 15mm+, wet = 5mm+. The forecast only reaches about 2 weeks out, so later jobs show no rain yet.
        {days.length > 0 && wetJobDays.length === 0 && " No booked job is on a wet day."}{" "}
        {days.length > 0 && <button className="link-btn" onClick={onPushBack}>Push jobs back…</button>}
      </p>
    </div>
  );
}

// Shift every booked job from a date onwards by some working days — for when a wet spell pushes everything back.
function PushBackModal({ quotes, forecast, jobsByDate, onApply, onClose }) {
  const t = today();
  const firstWet = (forecast || []).find((d) => isWetDay(d) && (jobsByDate[d.date] || []).length > 0);
  const dated = quotes.filter((q) => q.status === "Accepted" && isIsoDate(q.startDate) && q.startDate >= t).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const [from, setFrom] = useState(firstWet?.date || dated[0]?.startDate || t);
  const [days, setDays] = useState(2);
  const n = Math.max(0, Math.round(Number(days) || 0));
  const affected = dated.filter((q) => q.startDate >= from).map((q) => ({ q, to: shiftWorkDays(q.startDate, n, worksSaturday(q)) }));

  return (
    <Modal title="Push jobs back" onClose={onClose}>
      <p className="calc-note">Moves every booked job that starts on or after the date below by the same number of working days (weekends skipped), so the gaps between jobs stay the same. You can still move any one of them afterwards.</p>
      <div className="field-pair">
        <Field label="From (jobs starting on or after)"><input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
        <Field label="Push back by (working days)"><input type="number" min="0" step="1" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
      </div>
      {affected.length === 0 ? (
        <p className="calc-note">No booked jobs start on or after that date.</p>
      ) : (
        <div className="calc-preview">
          {affected.map(({ q, to }) => (
            <div key={q.id} className="calc-row">
              <span>{q.clientName || "Untitled"}</span>
              <span>{formatDateAU(q.startDate)} → {formatDateAU(to)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button className="btn-primary" disabled={affected.length === 0 || n === 0} onClick={() => onApply(affected.map(({ q, to }) => ({ id: q.id, startDate: to })))}>
          <Check size={15} /> Push back {affected.length} job{affected.length === 1 ? "" : "s"} by {n} day{n === 1 ? "" : "s"}
        </button>
      </div>
    </Modal>
  );
}

// Search box (+ optional filters) shared by the Quotes, Invoices and Leads lists.
function SearchBar({ value, onChange, placeholder, shown, total, children }) {
  return (
    <div className="search-row">
      <div className="search-box">
        <Search size={16} />
        <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
        {value && <button className="icon-btn" onClick={() => onChange("")} aria-label="Clear search"><X size={15} /></button>}
      </div>
      {children}
      {(value || shown !== total) && <div className="search-count">{shown} of {total}</div>}
    </div>
  );
}

function BoardCalendar({ events, onMove, go, weather = {} }) {
  const t = today();
  const [month, setMonth] = useState(t.slice(0, 7));
  const [selected, setSelected] = useState(t);
  const [editing, setEditing] = useState(null); // uid of the event whose date is being changed
  // What you type in the date/time boxes is held here and only applied when you press Save, so the arrow
  // keys can step the date as many times as you like without the job jumping away mid-edit.
  const [draft, setDraft] = useState({ date: "", time: "" });
  const startEditing = (e) => {
    setDraft({ date: e.editDate || e.date, time: e.time || "" });
    setEditing(e.uid);
  };
  const saveEditing = (e) => {
    if (draft.date) move(e, draft.date, draft.time);
    setEditing(null);
  };

  const byDate = useMemo(() => {
    const map = {};
    for (const e of events) (map[e.date] = map[e.date] || []).push(e);
    return map;
  }, [events]);
  // How much of each day is booked with jobs (1 = a full day). Over 1 means two jobs are fighting for the day.
  const loadByDate = useMemo(() => {
    const map = {};
    for (const e of events) if (e.kind === "job") map[e.date] = (map[e.date] || 0) + e.portion;
    return map;
  }, [events]);
  const isOver = (date) => (loadByDate[date] || 0) > 1.001;
  const cells = monthCells(month);
  const dayEvents = byDate[selected] || [];
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  const selLabel = new Date(`${selected}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });

  const pick = (date) => {
    setSelected(date);
    setEditing(null);
    if (date.slice(0, 7) !== month) setMonth(date.slice(0, 7));
  };
  const move = (e, date, time) => {
    onMove(e, date, time);
    if (date && date !== (e.editDate || e.date)) pick(date);
  };
  // Nudge a job / visit / invoice a day earlier or later (jobs hop over days they don't work).
  const shift = (e, dir) => {
    let d = addDaysIso(e.editDate || e.date, dir);
    if (e.kind === "job") for (let i = 0; i < 8 && !isWorkDay(d, e.saturday); i++) d = addDaysIso(d, dir);
    move(e, d, e.time);
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <CalendarDays size={16} />
        <span>Calendar</span>
      </div>
      <div className="cal-nav">
        <button className="icon-btn cal-nav-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronRight size={18} style={{ transform: "rotate(180deg)" }} /></button>
        <div className="cal-month">{monthLabel}</div>
        <button className="btn-ghost small" onClick={() => pick(t)}>Today</button>
        <button className="icon-btn cal-nav-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight size={18} /></button>
      </div>
      <div className="cal-grid">
        {WEEKDAYS.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {cells.map((c) => {
          const evs = byDate[c.date] || [];
          return (
            <button
              key={c.date}
              className={`cal-cell${c.inMonth ? "" : " out"}${c.date === t ? " is-today" : ""}${c.date === selected ? " is-selected" : ""}${isOver(c.date) ? " is-over" : ""}${isWetDay(weather[c.date]) ? " is-wet" : ""}`}
              onClick={() => pick(c.date)}
            >
              <span className="cal-day">{c.day}</span>
              {weather[c.date] && rainLevel(weather[c.date].rainMm) !== "dry" && (
                <span className={`cal-rain wx-${rainLevel(weather[c.date].rainMm)}`}><Droplets size={9} />{mmText(weather[c.date].rainMm).replace("mm", "")}</span>
              )}
              <span className="cal-dots">
                {evs.slice(0, 4).map((e) => <span key={e.uid} className={`cal-dot ${EVENT_KINDS[e.kind].cls}`} />)}
              </span>
              <span className="cal-chips">
                {evs.slice(0, 2).map((e) => <span key={e.uid} className={`cal-chip ${EVENT_KINDS[e.kind].cls}`}>{e.name}</span>)}
                {evs.length > 2 && <span className="cal-more">+{evs.length - 2} more</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="cal-legend">
        <span><i className="cal-dot kind-job" /> Job</span>
        <span><i className="cal-dot kind-visit" /> Site visit</span>
        <span><i className="cal-dot kind-followup" /> Follow-up</span>
        <span><i className="cal-dot kind-invoice" /> Invoice due</span>
      </div>

      <div className="day-label" style={{ marginTop: 14 }}>
        <strong>{selected === t ? "Today" : selLabel}</strong>
        {selected === t && <span>{selLabel}</span>}
      </div>
      {weather[selected] && (
        <div className={`wx-line wx-${rainLevel(weather[selected].rainMm)}`}>
          <Droplets size={13} /> {RAIN_LABEL[rainLevel(weather[selected].rainMm)]} forecast: {mmText(weather[selected].rainMm)}
          {weather[selected].chance != null ? ` (${weather[selected].chance}% chance)` : ""}, gusts {Math.round(weather[selected].gust)} km/h
        </div>
      )}
      {isOver(selected) && (
        <div className="over-warning">
          <AlertTriangle size={14} /> More than a day's work is booked on this day ({hoursLabel(Math.round((loadByDate[selected] || 0) * HOURS_PER_DAY * 4) / 4)}). Move one of them.
        </div>
      )}
      {dayEvents.length === 0 ? (
        <p className="calc-note" style={{ margin: 0 }}>Nothing on this day.</p>
      ) : (
        dayEvents.map((e) => {
          const k = EVENT_KINDS[e.kind];
          return (
            <div key={e.uid} className={`event-card ${k.cls}`}>
              <div className="event-row-plain" onClick={() => go(e.tab)}>
                <div className="event-icon"><k.icon size={16} /></div>
                <div className="event-main">
                  <div className="event-title">{e.name}</div>
                  <div className="event-sub">{e.label}{e.subtitle ? ` · ${e.subtitle}` : ""}</div>
                </div>
                {e.time && <div className="event-time">{fmtTime(e.time)}</div>}
              </div>
              {e.ref ? (
                editing === e.uid ? (
                  <div className="event-edit">
                    <input
                      type="date"
                      value={draft.date}
                      onChange={(ev) => setDraft((d) => ({ ...d, date: ev.target.value }))}
                      onKeyDown={(ev) => { if (ev.key === "Enter") saveEditing(e); if (ev.key === "Escape") setEditing(null); }}
                    />
                    {e.ref.timeField && (
                      <input type="time" value={draft.time} onChange={(ev) => setDraft((d) => ({ ...d, time: ev.target.value }))} />
                    )}
                    <button className="btn-primary small" onClick={() => saveEditing(e)} disabled={!draft.date}><Check size={13} /> Save</button>
                    <button className="btn-ghost small" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                ) : (
                  <div className="event-actions">
                    <button className="btn-ghost small" onClick={() => shift(e, -1)} aria-label="Move a day earlier"><ChevronRight size={14} style={{ transform: "rotate(180deg)" }} /> 1 day</button>
                    <button className="btn-ghost small" onClick={() => shift(e, 1)} aria-label="Move a day later">1 day <ChevronRight size={14} /></button>
                    <button className="btn-ghost small" onClick={() => startEditing(e)}>{e.kind === "job" ? "Change start date" : `Change date${e.ref.timeField ? " / time" : ""}`}</button>
                    {e.kind === "job" && e.dayCount > 1 && <span className="event-note" style={{ margin: 0 }}>Moves all {e.dayCount} days.</span>}
                  </div>
                )
              ) : (
                <div className="event-note">Follows 3 days after the quote was sent.</div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// Review screen for accepted jobs that don't have a start date yet: shows where each would go (next free
// working days, in the order they were accepted, around booked work) so you can tweak or skip before applying.
function ScheduleModal({ quotes, todo, blocked, onApply, onClose }) {
  const todoById = useMemo(() => Object.fromEntries(todo.map((q) => [q.id, q])), [todo]);
  const [rows, setRows] = useState(() =>
    suggestSchedule(quotes.filter((q) => isIsoDate(q.startDate) || todoById[q.id]), today(), { blocked }).map((p) => ({ id: p.quote.id, include: true, start: p.start }))
  );
  const setRow = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const booked = dayLoads(quotes.filter((q) => isIsoDate(q.startDate)));
  const preview = rows.map((r) => ({ ...r, q: { ...todoById[r.id], status: "Accepted", startDate: r.start } }));
  const load = { ...booked };
  for (const p of preview) if (p.include) for (const d of jobDays(p.q)) load[d.date] = (load[d.date] || 0) + d.portion;
  const chosen = preview.filter((p) => p.include && p.start);

  return (
    <Modal title="Schedule accepted jobs" onClose={onClose}>
      <p className="calc-note">
        These accepted jobs have no start date. Each is placed in the next free working days, in the order you accepted them, around work that's
        already booked, skipping days the forecast says are wet. Change any date, untick the ones you want to leave, then apply.
      </p>
      {preview.length === 0 && <p className="calc-note">Nothing to place.</p>}
      {preview.map((p) => {
        const e = estimateHours(p.q);
        const days = jobDays(p.q);
        const clash = days.some((d) => (load[d.date] || 0) > 1.001);
        return (
          <div key={p.id} className="schedule-row">
            <label className="check-row" style={{ margin: 0 }}>
              <input type="checkbox" checked={p.include} onChange={(ev) => setRow(p.id, { include: ev.target.checked })} />
              <span><strong>{p.q.clientName || "Untitled"}</strong> · {p.q.jobType} · {hoursLabel(e.hours)}</span>
            </label>
            <div className="schedule-dates">
              <input type="date" value={p.start} onChange={(ev) => ev.target.value && setRow(p.id, { start: ev.target.value })} disabled={!p.include} />
              {days.length > 1 && <span className="calc-note" style={{ margin: 0 }}>→ {formatDateAU(days[days.length - 1].date)}</span>}
            </div>
            {p.include && clash && <div className="over-warning"><AlertTriangle size={14} /> Overlaps other booked work on those days.</div>}
          </div>
        );
      })}
      <div className="modal-actions">
        <button className="btn-primary" disabled={chosen.length === 0} onClick={() => onApply(chosen.map((p) => ({ id: p.id, startDate: p.start })))}>
          <Check size={15} /> Place {chosen.length} job{chosen.length === 1 ? "" : "s"}
        </button>
      </div>
    </Modal>
  );
}

function Dashboard({ leads, quotes, invoices, materials, expenses, go, setLeads, setQuotes, setInvoices }) {
  const t = today();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [forecast, setForecast] = useState(null);
  const [forecastError, setForecastError] = useState("");
  useEffect(() => {
    let off = false;
    fetch("/api/weather")
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "unavailable");
        return body;
      })
      .then((b) => { if (!off) setForecast(b.days); })
      .catch((e) => { if (!off) setForecastError(e.message); });
    return () => { off = true; };
  }, []);
  const inc = (items) => gstBreakdown(itemsTotal(items)).total;
  const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
  const whole = (n) => money(Math.round(n)).replace(/\.00$/, "");
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const daysSince = (dateStr) => {
    if (!dateStr) return 0;
    const then = new Date(dateStr + "T00:00:00");
    return Math.floor((new Date().setHours(0, 0, 0, 0) - then.setHours(0, 0, 0, 0)) / 86400000);
  };

  const newLeads = leads.filter((l) => l.status === "New");
  const activeLeads = leads.filter((l) => !["Won", "Lost"].includes(l.status));
  const quotesOut = quotes.filter((q) => q.status === "Sent");
  const bookedJobs = quotes.filter((q) => q.status === "Accepted" && q.startDate && q.startDate >= t);
  const unpaidInvoices = invoices.filter((i) => i.status !== "Paid");
  const overdue = unpaidInvoices.filter((i) => i.dueDate && i.dueDate < t);
  const owed = sum(unpaidInvoices, (i) => inc(i.items));
  const lowStock = materials.filter((m) => Number(m.reorderLevel) > 0 && Number(m.qtyOnHand) <= Number(m.reorderLevel));
  // Accepted but no start date. A final invoice means the job's done; a deposit invoice just means it's booked in.
  const acceptedNoDate = quotes.filter((q) => q.status === "Accepted" && !isIsoDate(q.startDate) && !invoices.some((i) => i.quoteId === q.id && !isDepositInvoice(i)));

  // Quotes a client accepts themselves online are dropped into the next free slot as soon as the Board opens
  // (older undated jobs are left for you to review, so nothing gets a date you didn't see).
  // Washed-out days in the forecast are skipped when jobs are placed automatically.
  const wet = useMemo(() => wetDates(forecast), [forecast]);
  useEffect(() => {
    if (forecast === null && !forecastError) return; // placed once the forecast is in (or has failed), so wet days can be skipped
    const fresh = acceptedNoDate.filter((q) => q.acceptedAt && daysSince(q.acceptedAt) >= 0 && daysSince(q.acceptedAt) <= 14);
    if (fresh.length === 0) return;
    const ids = new Set(fresh.map((q) => q.id));
    const placed = suggestSchedule(quotes.filter((q) => isIsoDate(q.startDate) || ids.has(q.id)), today(), { blocked: wet }).filter((p) => ids.has(p.quote.id));
    if (placed.length === 0) return;
    setQuotes((rows) => rows.map((r) => {
      const p = placed.find((x) => x.quote.id === r.id);
      return p && !isIsoDate(r.startDate) ? { ...r, startDate: p.start } : r;
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, forecast, forecastError]);
  const staleQuotes = quotes.filter((q) => q.status === "Sent" && daysSince(q.date) > 30);

  // ----- schedule: next 2 weeks by day, plus the next few far-off jobs/visits -----
  const allEvents = scheduleEvents({ leads, quotes, invoices });
  const upcoming = allEvents.filter((e) => e.date >= t);
  // Which clients have a job on each date, and the forecast keyed by date — for the rain flags.
  const jobsByDate = {};
  for (const e of allEvents) if (e.kind === "job") (jobsByDate[e.date] = jobsByDate[e.date] || []).push(e.name);
  const wxByDate = Object.fromEntries((forecast || []).map((d) => [d.date, d]));

  // Changing a date on the calendar edits the real record (quote start date, lead visit, invoice due date).
  const moveEvent = (e, date, time) => {
    const setRows = { quotes: setQuotes, leads: setLeads, invoices: setInvoices }[e.ref.table];
    const patch = { [e.ref.field]: date };
    if (e.ref.timeField) patch[e.ref.timeField] = time || "";
    setRows((rows) => rows.map((r) => (r.id === e.ref.id ? { ...r, ...patch } : r)));
  };
  const soonLimit = addDaysIso(t, 14);
  const soon = upcoming.filter((e) => e.date <= soonLimit);
  const later = upcoming.filter((e) => e.date > soonLimit && (e.kind === "job" || e.kind === "visit")).slice(0, 3);
  const days = [];
  for (const e of soon) {
    const last = days[days.length - 1];
    if (last && last.date === e.date) last.events.push(e);
    else days.push({ date: e.date, events: [e] });
  }
  const todayCount = soon.filter((e) => e.date === t).length;

  // ----- money this month -----
  const thisMonth = new Date().toISOString().slice(0, 7);
  // Income inc. GST, to match expenses (logged as the GST-inclusive receipt amount) — otherwise "Net" compares apples to oranges.
  const monthIncome = sum(
    invoices.filter((i) => i.status === "Paid" && (i.paidDate || i.issuedDate || "").slice(0, 7) === thisMonth),
    (i) => inc(i.items)
  );
  const monthExpense = sum(expenses.filter((e) => (e.date || "").slice(0, 7) === thisMonth), (e) => Number(e.amount || 0));

  const phoneLeads = newLeads.filter((l) => l.source === "phone_agent").length;
  const names = (list, get) => {
    const shown = list.slice(0, 3).map(get).join(", ");
    return list.length > 3 ? `${shown} +${list.length - 3} more` : shown;
  };
  const attention = [];
  if (overdue.length > 0) {
    attention.push({ key: "overdue", bad: true, icon: AlertTriangle, tab: "invoices",
      text: `${plural(overdue.length, "overdue invoice")} — ${whole(sum(overdue, (i) => inc(i.items)))} to chase`,
      sub: names(overdue, (i) => i.clientName) });
  }
  if (newLeads.length > 0) {
    attention.push({ key: "leads", icon: Users, tab: "leads",
      text: `${plural(newLeads.length, "new lead")} to contact${phoneLeads ? ` (${phoneLeads} from the phone agent)` : ""}`,
      sub: names(newLeads, (l) => l.name) });
  }
  const maybeCancelled = leads.filter((l) => (l.status === "New" || l.status === "Contacted") && cancellationHint(l.notes));
  if (maybeCancelled.length > 0) {
    attention.push({ key: "cancel", bad: true, icon: AlertTriangle, tab: "visits",
      text: `${plural(maybeCancelled.length, "client")} may have cancelled by text — check before you drive out`,
      sub: names(maybeCancelled, (l) => String(l.name || "").replace(/\?/g, "").trim()) });
  }
  const askedToMove = leads.filter((l) => l.status !== "Lost" && rescheduleHint(l.notes, t));
  if (askedToMove.length > 0) {
    attention.push({ key: "resched", icon: CalendarDays, tab: "visits",
      text: `${plural(askedToMove.length, "client")} asked to reschedule by text — tap to move ${askedToMove.length === 1 ? "them" : "them"}`,
      sub: names(askedToMove, (l) => String(l.name || "").replace(/\?/g, "").trim()) });
  }
  if (acceptedNoDate.length > 0) {
    attention.push({ key: "nodate", icon: CalendarDays, onClick: () => setScheduleOpen(true),
      text: `${plural(acceptedNoDate.length, "accepted job")} with no start date — tap to schedule ${acceptedNoDate.length === 1 ? "it" : "them"}`,
      sub: names(acceptedNoDate, (q) => q.clientName) });
  }
  if (staleQuotes.length > 0) {
    attention.push({ key: "stale", icon: FileText, tab: "quotes",
      text: `${plural(staleQuotes.length, "quote")} sent over a month ago with no answer`,
      sub: `Mark them Declined if they're dead — ${names(staleQuotes, (q) => q.clientName)}` });
  }
  if (lowStock.length > 0) {
    attention.push({ key: "stock", icon: Boxes, tab: "materials",
      text: `${plural(lowStock.length, "material")} at or below reorder level`,
      sub: names(lowStock, (m) => m.name) });
  }

  const cards = [
    { label: "New leads", value: newLeads.length, sub: `${activeLeads.length} active`, icon: Users, tab: "leads", tone: "timber" },
    { label: "Quotes out", value: quotesOut.length, sub: `${whole(sum(quotesOut, (q) => inc(q.items)))} inc. GST`, icon: FileText, tab: "quotes", tone: "steel" },
    { label: "Booked jobs", value: bookedJobs.length, sub: `${whole(sum(bookedJobs, (q) => inc(q.items)))} inc. GST`, icon: Hammer, tab: "quotes", tone: "hivis" },
    { label: "Owed to you", value: whole(owed), sub: plural(unpaidInvoices.length, "unpaid invoice"), icon: Receipt, tab: "invoices", tone: "good", warn: overdue.length > 0 },
  ];

  const EventRow = ({ e, showDate }) => {
    const k = EVENT_KINDS[e.kind];
    return (
      <div className={`event-row ${k.cls}`} onClick={() => go(e.tab)}>
        <div className="event-icon"><k.icon size={16} /></div>
        <div className="event-main">
          <div className="event-title">{e.name}</div>
          <div className="event-sub">{e.label}{showDate ? ` · ${formatDateAU(e.date)}` : ""}{e.subtitle ? ` · ${e.subtitle}` : ""}</div>
        </div>
        {e.time && <div className="event-time">{fmtTime(e.time)}</div>}
      </div>
    );
  };

  return (
    <div>
      <div className="board-hello">
        <div className="board-hello-title">{"G'day, Artie"}</div>
        <div className="board-hello-date">
          {new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
          {todayCount > 0 ? ` · ${todayCount} on today` : ""}
        </div>
      </div>

      <div className="card-grid">
        {cards.map((c) => (
          <button key={c.label} className={`stat-card tone-${c.tone}${c.warn ? " warn" : ""}`} onClick={() => go(c.tab)}>
            <div className="stat-icon"><c.icon size={18} /></div>
            <div className="stat-value">{c.value}</div>
            <div className="stat-label">{c.label}</div>
            <div className="stat-sub">{c.sub}</div>
          </button>
        ))}
      </div>

      <DaySheet events={allEvents} quotes={quotes} leads={leads} forecast={forecast} go={go} />

      <WeatherPanel forecast={forecast} error={forecastError} jobsByDate={jobsByDate} onPushBack={() => setPushOpen(true)} />

      <BoardCalendar events={allEvents} onMove={moveEvent} go={go} weather={wxByDate} />

      <div className="panel">
        <div className="panel-head">
          <CalendarDays size={16} />
          <span>Coming up — next 2 weeks</span>
        </div>
        {days.length === 0 ? (
          <p className="calc-note" style={{ margin: 0 }}>
            Nothing scheduled. Set a job start date on an accepted quote, or a site visit date on a lead, and it shows up here (and in your iPhone calendar).
          </p>
        ) : (
          days.map((day) => {
            const h = dayHeading(day.date);
            return (
              <div key={day.date}>
                <div className={`day-label${h.isToday ? " today" : ""}`}>
                  <strong>{h.main}</strong>
                  <span>{h.sub}</span>
                </div>
                {day.events.map((e) => <EventRow key={e.uid} e={e} />)}
              </div>
            );
          })
        )}
        {later.length > 0 && (
          <div>
            <div className="day-label"><strong>Later</strong></div>
            {later.map((e) => <EventRow key={e.uid} e={e} showDate />)}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <AlertTriangle size={16} />
          <span>Needs your attention</span>
        </div>
        {attention.length === 0 ? (
          <div className="all-clear"><Check size={16} /> All clear — nothing needs chasing right now.</div>
        ) : (
          attention.map((a) => (
            <div key={a.key} className={`attention-row${a.bad ? " bad" : ""}`} onClick={() => (a.onClick ? a.onClick() : go(a.tab))}>
              <a.icon size={16} />
              <div className="attention-main">
                <div>{a.text}</div>
                {a.sub && <div className="attention-sub">{a.sub}</div>}
              </div>
              <ChevronRight size={16} />
            </div>
          ))
        )}
      </div>

      <TextsToSend quotes={quotes} invoices={invoices} leads={leads} setQuotes={setQuotes} setInvoices={setInvoices} setLeads={setLeads} />

      <div className="panel">
        <div className="panel-head">
          <TrendingUp size={16} />
          <span>This month</span>
        </div>
        <div className="cashflow-row">
          <div>
            <div className="cf-label">Income (paid)</div>
            <div className="cf-value good">{money(monthIncome)}</div>
          </div>
          <div>
            <div className="cf-label">Expenses</div>
            <div className="cf-value bad">{money(monthExpense)}</div>
          </div>
          <div>
            <div className="cf-label">Net</div>
            <div className={`cf-value ${monthIncome - monthExpense >= 0 ? "good" : "bad"}`}>
              {money(monthIncome - monthExpense)}
            </div>
          </div>
        </div>
      </div>

      {pushOpen && (
        <PushBackModal
          quotes={quotes}
          forecast={forecast}
          jobsByDate={jobsByDate}
          onClose={() => setPushOpen(false)}
          onApply={(list) => {
            setQuotes((rows) => rows.map((r) => {
              const a = list.find((x) => x.id === r.id);
              return a ? { ...r, startDate: a.startDate } : r;
            }));
            setPushOpen(false);
          }}
        />
      )}
      {scheduleOpen && (
        <ScheduleModal
          quotes={quotes}
          todo={acceptedNoDate}
          blocked={wet}
          onClose={() => setScheduleOpen(false)}
          onApply={(assignments) => {
            setQuotes((rows) => rows.map((r) => {
              const a = assignments.find((x) => x.id === r.id);
              return a ? { ...r, startDate: a.startDate } : r;
            }));
            setScheduleOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---------- Leads ----------
function Leads({ leads, setLeads, go }) {
  const [modal, setModal] = useState(null); // {mode:'new'|'edit', data}
  const [introFor, setIntroFor] = useState(null); // the new lead whose first text is being written
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const visibleLeads = leads.filter((l) => (!statusFilter || l.status === statusFilter) && matchesQuery(leadText(l), query));

  const save = (data) => {
    if (data.id) {
      setLeads((ls) => ls.map((l) => (l.id === data.id ? data : l)));
    } else {
      setLeads((ls) => [{ ...data, id: uid(), createdAt: today() }, ...ls]);
    }
    setModal(null);
  };
  const remove = (id) => setLeads((ls) => ls.filter((l) => l.id !== id));

  return (
    <div>
      <div className="section-head row">
        <div>
          <h1>Leads</h1>
          <p>Enquiries and jobs working their way toward a quote.</p>
        </div>
        <button className="btn-primary" onClick={() => setModal({ mode: "new" })}>
          <Plus size={16} /> New lead
        </button>
      </div>

      {leads.length > 0 && (
        <SearchBar value={query} onChange={setQuery} placeholder="Search leads — name, phone, address, notes…" shown={visibleLeads.length} total={leads.length}>
          <select className="search-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </SearchBar>
      )}
      {leads.length === 0 ? (
        <EmptyState icon={Users} title="No leads yet" hint="Add an enquiry as soon as it comes in — by phone, form, or a mate's referral." onAdd={() => setModal({ mode: "new" })} addLabel="Add lead" />
      ) : visibleLeads.length === 0 ? (
        <p className="calc-note" style={{ textAlign: "center", padding: "24px 0" }}>No leads match "{query}"{statusFilter ? ` with status ${statusFilter}` : ""}.</p>
      ) : (
        <div className="list">
          {visibleLeads.map((l) => (
            <div className="row-card" key={l.id} onClick={() => setModal({ mode: "edit", data: l })}>
              <div className="row-card-main">
                <div className="row-card-title">{l.name}</div>
                <div className="row-card-meta">
                  {l.jobType} {l.address ? `· ${l.address}` : ""}
                  {l.visitDate ? ` · Site visit ${formatDateAU(l.visitDate)}${l.visitTime ? ` ${l.visitTime}` : ""}` : ""}
                </div>
              </div>
              {needsIntro(l) && (
                <button className="btn-primary small" onClick={(e) => { e.stopPropagation(); setIntroFor(l); }} title="A first text to send from your phone, ready to edit"><Send size={13} /> Intro text</button>
              )}
              {["New", "Contacted"].includes(l.status) && (
                <button className="btn-ghost small" onClick={(e) => { e.stopPropagation(); go("quotes", { newFromLead: l }); }} title="Start a quote with their details filled in"><FileText size={13} /> Start quote</button>
              )}
              <Tag label={l.status} />
            </div>
          ))}
        </div>
      )}

      {introFor && <IntroTextModal lead={introFor} onClose={() => setIntroFor(null)} onSent={(lead) => setLeads((ls) => ls.map((x) => (x.id === lead.id && x.status === "New" ? { ...x, status: "Contacted" } : x)))} />}

      {modal && (
        <LeadModal
          initial={modal.data}
          onClose={() => setModal(null)}
          onSave={save}
          onDelete={modal.data ? () => { remove(modal.data.id); setModal(null); } : null}
          onQuote={modal.data ? () => go("quotes", { newFromLead: modal.data }) : null}
        />
      )}
    </div>
  );
}

function LeadModal({ initial, onClose, onSave, onDelete, onQuote }) {
  const [form, setForm] = useState(
    initial || { name: "", phone: "", email: "", address: "", jobType: JOB_TYPES[0], status: "New", notes: "" }
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const [showText, setShowText] = useState(false);

  return (
    <Modal title={initial ? "Edit lead" : "New lead"} onClose={onClose}>
      <Field label="Name"><input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Client or business name" /></Field>
      <div className="field-pair">
        <Field label="Phone"><input value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} placeholder="04xx xxx xxx" /></Field>
        <Field label="Email"><input value={form.email || ""} onChange={(e) => set("email", e.target.value)} placeholder="name@email.com" /></Field>
      </div>
      <Field label="Job address"><input value={form.address || ""} onChange={(e) => set("address", e.target.value)} placeholder="Site address" /></Field>
      <div className="field-pair">
        <Field label="Job type">
          <select value={form.jobType} onChange={(e) => set("jobType", e.target.value)}>
            {JOB_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <div className="field-pair">
        <Field label="Site visit date"><input type="date" value={form.visitDate || ""} onChange={(e) => set("visitDate", e.target.value)} /></Field>
        <Field label="Visit time (optional)"><input type="time" value={form.visitTime || ""} onChange={(e) => set("visitTime", e.target.value)} /></Field>
      </div>
      <p className="calc-note" style={{ marginTop: -6 }}>A site visit goes straight into your iPhone calendar with reminders (see the calendar button at the top).</p>
      <Field label="Notes (site notes become the quote)">
        <textarea rows={4} value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder={"One job per line, e.g.\n26m 1.8 colorbond raked\nremove old fence\n1 gate\n(“Available from 3:30pm onwards.” is picked up by the visit planner)"} />
        {(() => {
          const d = parseSiteNotes(ownNotes(form.notes), { jobType: form.jobType });
          return d.items.length > 0 ? <span className="calc-note" style={{ display: "block", marginTop: 6 }}><Check size={12} style={{ verticalAlign: "-2px" }} /> Quote preview: {d.summary.join(" · ")} — tap Start quote to draft it.</span> : null;
        })()}
      </Field>
      <div className="calc-trigger-row" style={{ marginTop: -4 }}>
        <button type="button" className="btn-ghost small" onClick={() => setShowText(true)}><ClipboardPaste size={14} /> Paste a text from them</button>
      </div>
      {showText && (
        <TextImportModal
          lead={form}
          onClose={() => setShowText(false)}
          onApply={(patch) => { setForm((f) => ({ ...f, ...patch })); setShowText(false); }}
        />
      )}

      <div className="modal-actions">
        {onDelete && <button className="btn-danger" onClick={onDelete}><Trash2 size={15} /> Delete</button>}
        {onQuote && <button className="btn-ghost" onClick={onQuote}><FileText size={15} /> Start quote</button>}
        <button className="btn-primary" onClick={() => onSave(form)} disabled={!form.name}><Check size={15} /> Save</button>
      </div>
    </Modal>
  );
}

// ---------- Line items editor (shared by Quotes & Invoices) ----------
function LineItems({ items, setItems, defaultLength, fenceHeight, onInsertTemplate }) {
  const update = (id, k, v) => setItems((its) => its.map((it) => (it.id === id ? { ...it, [k]: v } : it)));
  const remove = (id) => setItems((its) => its.filter((it) => it.id !== id));
  const add = () => setItems((its) => [...its, { id: uid(), desc: "", qty: 1, rate: 0 }]);
  const insertTemplate = (e) => {
    const label = e.target.value;
    const t = JOB_TEMPLATES.find((j) => j.label === label);
    if (t) {
      const qty = t.unit === "m" ? Number(defaultLength) || 1 : 1;
      const desc = t.desc.replace(/\{height\}/g, fenceHeight || "1.8");
      const rate = t.rateFn ? t.rateFn(fenceHeight) : t.rate;
      setItems((its) => [...its, { id: uid(), desc, qty, rate, unit: t.unit, tpl: t.label }]);
      onInsertTemplate?.(t);
    }
    e.target.value = "";
  };

  return (
    <div className="line-items">
      {items.map((it) => (
        <div className="line-item" key={it.id}>
          <input className="li-desc" placeholder="Description" value={it.desc} onChange={(e) => update(it.id, "desc", e.target.value)} />
          <input className="li-num" type="number" placeholder="Qty" value={it.qty} onChange={(e) => update(it.id, "qty", e.target.value)} />
          <input className="li-num" type="number" placeholder="Rate" value={it.rate} onChange={(e) => update(it.id, "rate", e.target.value)} />
          <span className="li-total">{money(Number(it.qty || 0) * Number(it.rate || 0))}</span>
          <button className="icon-btn" onClick={() => remove(it.id)}><X size={14} /></button>
        </div>
      ))}
      <div className="li-add-row">
        <button className="btn-ghost small" onClick={add}><Plus size={14} /> Add line</button>
        <select className="template-picker" defaultValue="" onChange={insertTemplate}>
          <option value="" disabled>Insert job template…</option>
          {JOB_TEMPLATES.map((t) => (
            <option key={t.label} value={t.label}>{t.label} (${t.rateFn ? t.rateFn(fenceHeight) : t.rate}/{t.unit})</option>
          ))}
        </select>
      </div>
      <div className="li-grand-total">Total: <strong>{money(itemsTotal(items))}</strong></div>
    </div>
  );
}

function MaterialCalcModal({ onClose, onApply, materials, prefill, quoteDefaults }) {
  const [form, setForm] = useState({
    style: prefill?.style || quoteDefaults?.style || "timber",
    timberStyle: prefill?.timberStyle || quoteDefaults?.timberStyle || "butted",
    length: prefill?.length_m ?? quoteDefaults?.length ?? "",
    height: prefill?.height_m ?? quoteDefaults?.height ?? "1.8",
    raked: !!quoteDefaults?.raked,
    sleeper: !!quoteDefaults?.sleeper,
    slatWidth: String(quoteDefaults?.slatWidth || 65),
    gap: "10",
    gates: prefill?.gates ?? "0",
    gateWidth: String(quoteDefaults?.gateWidth || "1"),
    postSpacing: "",
    panelWidth: "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const preview = useMemo(() => calcMaterials({ ...form, materials }), [form, materials]);
  const total = itemsTotal(preview);

  return (
    <Modal title="Calculate materials" onClose={onClose}>
      {prefill && (
        <div className="fuel-note">
          <Camera size={14} /> Filled in from your photo — double-check before adding.
          {prefill.notes ? ` ${prefill.notes}` : ""}
        </div>
      )}
      <div className="field-pair">
        <Field label="Fence style">
          <select value={form.style} onChange={(e) => set("style", e.target.value)}>
            <option value="timber">Timber</option>
            <option value="colorbond">Colorbond</option>
            <option value="aluminium">Aluminium slat</option>
          </select>
        </Field>
        <Field label="Length (m)"><input type="number" value={form.length} onChange={(e) => set("length", e.target.value)} placeholder="e.g. 24" /></Field>
      </div>
      {form.style === "colorbond" && (
        <label className="check-row">
          <input type="checkbox" checked={!!form.raked} onChange={(e) => set("raked", e.target.checked)} />
          <span>Raked (sheets cut down to follow a slope) — a 1.8m fence then uses the 2100mm sheets</span>
        </label>
      )}
      {form.style === "timber" && (
        <Field label="Timber style">
          <select value={form.timberStyle} onChange={(e) => set("timberStyle", e.target.value)}>
            <option value="butted">Butted paling</option>
            <option value="lapped">Lapped & capped (good neighbour)</option>
          </select>
        </Field>
      )}
      {form.style === "aluminium" && (() => {
        const L = aluminiumLayout(form);
        return (
          <>
            <div className="field-pair">
              <Field label="Slat width">
                <select value={form.slatWidth} onChange={(e) => set("slatWidth", e.target.value)}>
                  <option value="65">65mm slats</option>
                  <option value="90">90mm slats</option>
                </select>
              </Field>
              <Field label="Gap between slats (mm)"><input type="number" value={form.gap} onChange={(e) => set("gap", e.target.value)} /></Field>
            </div>
            <p className="calc-note" style={{ color: "var(--good)" }}>
              <Check size={12} style={{ verticalAlign: "-2px" }} /> {L.nSlats} slats a panel = {L.finished}mm high. {Number(form.length) > 0 ? `${L.panels} panel${L.panels === 1 ? "" : "s"} at ${L.centres.toFixed(2)}m post centres (${L.perLength} slat${L.perLength === 1 ? "" : "s"} from each 5800mm length). ` : ""}Slats, posts and covers come in 5800mm lengths that can't be cut in store, so offcuts are in the cost. Type a bay width below to change the post centres.
            </p>
          </>
        );
      })()}
      {form.style !== "aluminium" && (
      <label className="check-row">
        <input type="checkbox" checked={!!form.sleeper} onChange={(e) => set("sleeper", e.target.checked)} />
        <span>On a 200mm sleeper (the "w/ sleeper 2m" fence) — 1.8m of {form.style === "colorbond" ? "sheet" : "palings"} on a treated pine sleeper; adds the sleepers and longer posts</span>
      </label>
      )}
      <div className="field-pair">
        <Field label="Height (m)"><input type="number" step="0.1" value={form.height} onChange={(e) => set("height", e.target.value)} /></Field>
        <Field label="Gates"><input type="number" value={form.gates} onChange={(e) => set("gates", e.target.value)} /></Field>
      </div>
      {(form.style === "timber" || form.style === "aluminium") && Number(form.gates) > 0 && (
        <Field label={form.style === "aluminium" ? "Gate width (m) — 1.0m or less uses the 930 gate, wider the 1720 gate" : "Gate width (m) — palings for each gate are added to its cost"}>
          <input type="number" step="0.1" value={form.gateWidth} onChange={(e) => set("gateWidth", e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
      )}
      <div className="field-pair">
        <Field label="Bay width (m)"><input type="number" step="0.01" value={form.panelWidth} onChange={(e) => set("panelWidth", e.target.value)} placeholder={form.style === "colorbond" ? "2.365" : "2.4"} /></Field>
        <Field label="Post spacing (m)"><input type="number" step="0.01" value={form.postSpacing} onChange={(e) => set("postSpacing", e.target.value)} placeholder="same as bay width" /></Field>
      </div>
      {form.style === "colorbond" && Number(form.length) > 0 && !Number(form.panelWidth) && !Number(form.postSpacing) && (() => {
        const m = colorbondBays(form.length);
        return (
          <p className="calc-note" style={{ color: "var(--good)" }}>
            <Check size={12} style={{ verticalAlign: "-2px" }} /> Plan for {form.length}m: {m.std} × 2365mm bay{m.std === 1 ? "" : "s"}
            {m.long > 0 ? ` + 1 × 3125mm bay (4 sheets) at the end` : ""} — covers {m.covers.toFixed(2)}m. Type a bay width below to override.
          </p>
        );
      })()}
      <p className="calc-note">Costs are pulled from your Materials list where the name matches — anything showing $0.00 either isn't priced yet or the name didn't match closely enough (adjust it in Materials).</p>

      {preview.length > 0 && (
        <div className="calc-preview">
          {preview.map((it) => (
            <div key={it.id} className="calc-row"><span>{it.desc} × {it.qty}</span><span>{money(Number(it.qty) * Number(it.rate))}</span></div>
          ))}
          <div className="calc-row calc-row-total"><span>Estimated total</span><span>{money(total)}</span></div>
        </div>
      )}

      <div className="modal-actions">
        <button className="btn-primary" disabled={!form.length} onClick={() => onApply(total, preview)}>
          <Plus size={15} /> Add to your costs
        </button>
      </div>
    </Modal>
  );
}

// ---------- Quotes ----------
// The wet days in the forecast (a Set of dates), or null until it has loaded — used to keep automatic job dates off washouts.
function useWetDates() {
  const [wet, setWet] = useState(null);
  useEffect(() => {
    let off = false;
    fetch("/api/weather")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (!off && b?.days) setWet(wetDates(b.days)); })
      .catch(() => {});
    return () => { off = true; };
  }, []);
  return wet;
}

function Quotes({ quotes, setQuotes, setLeads, invoices, setInvoices, pendingNewFrom, clearPending, settings, materials, bumpDocNumber, go }) {
  const wetDays = useWetDates();
  const [modal, setModal] = useState(null);
  const [quickScanning, setQuickScanning] = useState(false);
  const [quickScanError, setQuickScanError] = useState("");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [finalInvoiceQuote, setFinalInvoiceQuote] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const visibleQuotes = quotes.filter((q) => (!statusFilter || q.status === statusFilter) && matchesQuery(quoteText(q), query));
  const quickFileInputRef = useRef(null);
  const previewNumber = () => `LFS${settings?.nextDocNumber || 458}`;

  // Sum of any invoices already paid against this quote (deposit or part-payment),
  // so the final invoice can suggest subtracting what's already been collected.
  const linkedPaidTotal = (quoteId) =>
    (invoices || [])
      .filter((i) => i.quoteId === quoteId && i.status === "Paid")
      .reduce((s, i) => s + gstBreakdown(itemsTotal(i.items)).total, 0);

  useEffect(() => {
    if (pendingNewFrom) {
      // Name, phone, address (split into street and suburb), and job type all come across from the lead.
      setModal({
        mode: "new",
        data: { ...quoteFromLead(pendingNewFrom), docNumber: previewNumber() },
      });
      clearPending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNewFrom]);

  const save = (data) => {
    const { _fromLeadId, _draft, ...row } = data;
    if (row.id) setQuotes((qs) => qs.map((q) => (q.id === row.id ? row : q)));
    else {
      bumpDocNumber();
      setQuotes((qs) => [{ ...row, id: uid(), date: row.date || today() }, ...qs]);
      // A quote started from a lead means the site visit is done: the lead moves to Quoted (and leaves the Visit planner).
      if (_fromLeadId) setLeads((ls) => ls.map((l) => (l.id === _fromLeadId && ["New", "Contacted"].includes(l.status) ? { ...l, status: "Quoted" } : l)));
    }
    setModal(null);
  };
  const remove = (id) => setQuotes((qs) => qs.filter((q) => q.id !== id));

  // Opens a fresh, unsaved copy of a quote (what's on screen, including any edits) so a
  // second similar quote for the same client doesn't mean starting from scratch.
  const duplicate = (q) => {
    const { id: _id, inserted_at: _ins, ...rest } = q;
    setModal({
      mode: "new",
      dupKey: Date.now(), // forces the form to reload with the copy instead of reusing the old one
      data: {
        ...rest,
        docNumber: previewNumber(),
        status: "Draft",
        date: today(),
        startDate: "",
        acceptedAt: null,
        acceptedByName: null,
        items: (q.items || []).map((it) => ({ ...it, id: uid() })),
        materialsBreakdown: (q.materialsBreakdown || []).map((it) => ({ ...it, id: uid() })),
      },
    });
  };

  const openFinalInvoice = (q) => {
    setModal(null);
    setFinalInvoiceQuote(q);
  };

  // "Create deposit invoice" straight from the open quote: saves the quote as it's currently
  // filled in (so the invoice matches what's on screen), then raises the deposit invoice.
  const saveAndCreateDeposit = (form) => {
    const isNew = !form.id;
    const quote = { ...form, id: form.id || uid(), date: form.date || today() };
    // A brand-new quote takes the next number itself, so the invoice gets the one after it.
    const invoiceNumber = isNew ? `LFS${(Number(settings?.nextDocNumber) || 458) + 1}` : previewNumber();
    if (isNew) {
      bumpDocNumber();
      setQuotes((qs) => [quote, ...qs]);
    } else {
      setQuotes((qs) => qs.map((q) => (q.id === quote.id ? quote : q)));
    }
    createDepositInvoice(quote, invoiceNumber);
  };

  // Bills the full scope of works, minus anything already paid toward the job
  // (a deposit invoice you raised, or an amount you took outside the app —
  // either way it's entered on the Final invoice modal). If nothing's been
  // paid, this is just the full quote amount, same as billing it outright.
  const createFinalInvoice = (q, depositPaid) => {
    const docNumber = previewNumber();
    bumpDocNumber();
    const items = (q.items || []).map((it) => ({ ...it }));
    const deposit = Number(depositPaid) || 0;
    if (deposit > 0) {
      items.push({
        id: uid(),
        desc: "Less: deposit / part-payment already received.",
        qty: 1,
        rate: Number((-deposit / 1.1).toFixed(2)),
        unit: "job",
      });
    }
    const inv = {
      id: uid(),
      docNumber,
      clientName: q.clientName,
      clientEmail: q.clientEmail || "",
      address: q.address,
      suburb: q.suburb,
      jobType: q.jobType,
      items,
      status: "Unpaid",
      issuedDate: today(),
      dueDate: "",
      notes: `Final invoice for completed job, per quote ${q.docNumber || ""}.`,
      quoteId: q.id,
    };
    setInvoices((is) => [inv, ...is]);
    setQuotes((qs) => qs.map((x) => (x.id === q.id ? { ...x, status: "Accepted" } : x)));
    setFinalInvoiceQuote(null);
  };

  // Bills just the deposit — the ex-GST line amount works out so that once GST is
  // added back on, the invoice total lands exactly on the deposit % of the full job.
  // `docNumber` is passed in when the quote was only just created (it took the next number itself).
  const createDepositInvoice = (q, docNumber = previewNumber()) => {
    bumpDocNumber();
    const depositPct = Number(q.depositPercent) || 10;
    const exGstAmount = itemsTotal(q.items) * (depositPct / 100);
    const inv = {
      id: uid(),
      docNumber,
      clientName: q.clientName,
      clientEmail: q.clientEmail || "",
      address: q.address,
      suburb: q.suburb,
      jobType: q.jobType,
      items: [{
        id: uid(),
        desc: `Deposit (${depositPct}%) for ${q.docNumber || "quote"} — ${q.jobType || "fencing"} job${q.startDate ? `, starting ${formatDateAU(q.startDate)}` : ""}.`,
        qty: 1,
        rate: Number(exGstAmount.toFixed(2)),
        unit: "job",
      }],
      status: "Unpaid",
      issuedDate: today(),
      // A deposit is due before the job starts: the day before the start date, or today if that's already passed.
      dueDate: q.startDate ? (addDaysIso(q.startDate, -1) < today() ? today() : addDaysIso(q.startDate, -1)) : "",
      notes: `${DEPOSIT_DUE_NOTE}, per quote ${q.docNumber || ""}.`,
      quoteId: q.id,
    };
    setInvoices((is) => [inv, ...is]);
    setModal(null);
    go?.("invoices");
  };

  const handleQuickScan = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setQuickScanning(true);
    setQuickScanError("");
    try {
      const result = await scanJobPhoto(file);
      setModal({ mode: "new", data: { items: [], docNumber: previewNumber(), _autoPrefill: result } });
    } catch (err) {
      setQuickScanError(err.message || "Couldn't read that photo — try a clearer shot, or use New quote and enter details manually.");
    } finally {
      setQuickScanning(false);
      e.target.value = "";
    }
  };

  return (
    <div>
      <div className="section-head row">
        <div>
          <h1>Quotes</h1>
          <p>Price up a job and track whether it lands.</p>
        </div>
        <div className="btn-stack">
          <button className="btn-ghost" onClick={() => setBulkImportOpen(true)}>
            <ClipboardPaste size={16} /> Bulk import
          </button>
          <button className="btn-ghost" onClick={() => quickFileInputRef.current?.click()} disabled={quickScanning}>
            <Camera size={16} /> {quickScanning ? "Reading…" : "Scan photo"}
          </button>
          <input type="file" accept="image/*" ref={quickFileInputRef} style={{ display: "none" }} onChange={handleQuickScan} />
          <button className="btn-primary" onClick={() => setModal({ mode: "new", data: { items: [], docNumber: previewNumber() } })}>
            <Plus size={16} /> New quote
          </button>
        </div>
      </div>
      {quickScanError && <p className="calc-note" style={{ color: "var(--bad)", marginBottom: 14 }}>{quickScanError}</p>}
      {bulkImportOpen && (
        <BulkImportQuotesModal
          onClose={() => setBulkImportOpen(false)}
          onApply={(newQuotes) => {
            setQuotes((qs) => [...newQuotes, ...qs]);
            setBulkImportOpen(false);
          }}
        />
      )}

      {quotes.length > 0 && (
        <SearchBar value={query} onChange={setQuery} placeholder="Search quotes — name, number, address, amount, notes…" shown={visibleQuotes.length} total={quotes.length}>
          <select className="search-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {QUOTE_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </SearchBar>
      )}
      {quotes.length === 0 ? (
        <EmptyState icon={FileText} title="No quotes yet" hint="Build a quote once you know the scope of a job." onAdd={() => setModal({ mode: "new", data: { items: [], docNumber: previewNumber() } })} addLabel="Add quote" />
      ) : visibleQuotes.length === 0 ? (
        <p className="calc-note" style={{ textAlign: "center", padding: "24px 0" }}>No quotes match "{query}"{statusFilter ? ` with status ${statusFilter}` : ""}.</p>
      ) : (
        <div className="list">
          {visibleQuotes.map((q) => (
            <div className="row-card" key={q.id} onClick={() => setModal({ mode: "edit", data: q })}>
              <div className="row-card-main">
                <div className="row-card-title">{q.clientName || "Untitled"}</div>
                <div className="row-card-meta">{q.jobType || ""} · {money(itemsTotal(q.items))} + GST = {money(gstBreakdown(itemsTotal(q.items)).total)} · {q.date}{q.startDate ? ` · starts ${formatDateAU(q.startDate)}` : ""}</div>
              </div>
              <Tag label={q.status} />
            </div>
          ))}
        </div>
      )}

      {modal && (
        <QuoteModal
          key={modal.data?.id || `new-${modal.dupKey || 0}`}
          initial={modal.data}
          wetDays={wetDays}
          settings={settings}
          materials={materials}
          onClose={() => setModal(null)}
          onSave={save}
          onDelete={modal.data?.id ? () => { remove(modal.data.id); setModal(null); } : null}
          onDuplicate={modal.data?.id ? duplicate : null}
          onFinalInvoice={modal.data?.id ? () => openFinalInvoice(modal.data) : null}
          onCreateDeposit={saveAndCreateDeposit}
          allQuotes={quotes}
          depositInvoice={modal.data?.id ? invoices.find((i) => i.quoteId === modal.data.id && isDepositInvoice(i)) : null}
        />
      )}
      {finalInvoiceQuote && (
        <FinalInvoiceModal
          quote={finalInvoiceQuote}
          suggestedDeposit={linkedPaidTotal(finalInvoiceQuote.id)}
          onClose={() => setFinalInvoiceQuote(null)}
          onCreate={(depositPaid) => createFinalInvoice(finalInvoiceQuote, depositPaid)}
        />
      )}
    </div>
  );
}

function FinalInvoiceModal({ quote, suggestedDeposit, onClose, onCreate }) {
  const [deposit, setDeposit] = useState(suggestedDeposit > 0 ? suggestedDeposit.toFixed(2) : "");
  const quoteTotal = gstBreakdown(itemsTotal(quote.items)).total;
  const depositNum = Number(deposit) || 0;
  const balanceDue = Math.max(0, quoteTotal - depositNum);

  return (
    <Modal title="Create final invoice" onClose={onClose}>
      <p className="calc-note">
        Bills the remaining balance for {quote.clientName || "this job"} — the full scope of works, minus anything already paid. Leave the deposit field at $0 if the job went ahead without one.
      </p>
      <div className="cashflow-row" style={{ marginBottom: 12 }}>
        <div>
          <div className="cf-label">Job total (inc. GST)</div>
          <div className="cf-value">{money(quoteTotal)}</div>
        </div>
      </div>
      <Field label="Deposit / part-payment already received ($, inc. GST)">
        <input type="number" step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0.00" />
      </Field>
      {suggestedDeposit > 0 && (
        <p className="calc-note">Found a paid deposit invoice for this job worth {money(suggestedDeposit)} — pre-filled above, adjust if it's different.</p>
      )}
      <div className="job-cost-total" style={{ marginTop: 4 }}>
        <span>Balance due (inc. GST)</span><span>{money(balanceDue)}</span>
      </div>
      <div className="modal-actions">
        <button className="btn-primary" onClick={() => onCreate(depositNum)}>
          <Receipt size={15} /> Create invoice for {money(balanceDue)}
        </button>
      </div>
    </Modal>
  );
}

function QuoteModal({ initial, settings, materials, onClose, onSave, onDelete, onDuplicate, onFinalInvoice, onCreateDeposit, depositInvoice, allQuotes = [], wetDays = null }) {
  const [form, setForm] = useState({ clientName: "", clientPhone: "", address: "", suburb: "", jobType: JOB_TYPES[0], status: "Draft", date: today(), items: [], jobLength: "", fenceHeight: "1.8", distanceKm: "", employees: "", labourRateType: LABOUR_RATES[0].id, hours: "", removalLength: "", materialsCost: 0, docNumber: "", depositPercent: "10", notes: "", startDate: "", ...initial });
  const [showCalc, setShowCalc] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [scanPrefill, setScanPrefill] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [estimatingRoute, setEstimatingRoute] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [lookingUpSuburb, setLookingUpSuburb] = useState(false);
  const [suburbError, setSuburbError] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkFallback, setLinkFallback] = useState("");
  const fileInputRef = useRef(null);
  const [autoPlaced, setAutoPlaced] = useState(false); // the start date was filled in automatically when set to Accepted
  const [durUnit, setDurUnit] = useState("days");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItems = (updater) => setForm((f) => ({ ...f, items: typeof updater === "function" ? updater(f.items) : updater }));

  // Setting a quote to Accepted with no start date drops it into the next free slot after your booked work.
  // Nothing's locked in — change the date here, or move it on the Board calendar later.
  const changeStatus = (next) => {
    if (next === "Accepted" && !form.startDate) {
      const me = { ...form, id: form.id || "__new__", status: "Accepted" };
      // Only work that's actually booked in counts; undated accepted jobs are still waiting for you to review them.
      const booked = allQuotes.filter((q) => q.id !== form.id && isIsoDate(q.startDate));
      const p = suggestSchedule([...booked, me], today(), { blocked: wetDays }).find((x) => x.quote.id === me.id);
      if (p) {
        setForm((f) => ({ ...f, status: next, startDate: p.start }));
        setAutoPlaced(true);
        return;
      }
    }
    setForm((f) => ({ ...f, status: next }));
  };

  // How long the job will take, how that was worked out, and what you've typed over it.
  const est = estimateHours(form);
  const estWhy = (() => {
    const bits = [];
    const t = form.jobType;
    if (est.source === "set") return "set by you";
    if (est.source === "default") return "no length, gates or posts on the quote yet, so a half-day guess";
    if (t === "Retaining wall") return `${est.lengthM}m × ${Number(form.fenceHeight) || 0}m wall, about 5 m² a day`;
    if (t !== "Repairs" && t !== "Gates" && est.lengthM > 0) bits.push(`${est.lengthM}m at 10m per half day`);
    if (est.gates > 0) bits.push(`${est.gates} gate${est.gates === 1 ? "" : "s"} × 2 hrs`);
    else if (t === "Gates") bits.push("a gate job is about 2 hrs");
    if (est.posts > 0) bits.push(`${est.posts} post${est.posts === 1 ? "" : "s"} × 30 mins`);
    return bits.join(" + ");
  })();
  const typedShown = Number(form.durationHours) > 0 ? String(durUnit === "days" ? Number(form.durationHours) / HOURS_PER_DAY : Number(form.durationHours)) : "";
  const setTyped = (v) => {
    const n = Number(v);
    set("durationHours", v === "" || !(n > 0) ? "" : String(Math.round((durUnit === "days" ? n * HOURS_PER_DAY : n) * 100) / 100));
  };
  const runDays = form.status === "Accepted" ? jobDays(form) : [];

  const handleFindSuburb = async () => {
    if (!form.address) return;
    setLookingUpSuburb(true);
    setSuburbError("");
    try {
      const suburb = await lookupSuburb(form.address);
      set("suburb", suburb);
    } catch (err) {
      setSuburbError(err.message || "Couldn't find that address — enter the suburb manually.");
    } finally {
      setLookingUpSuburb(false);
    }
  };

  // Lets the client review and accept the quote themselves at /accept/[id] —
  // tries the native share sheet first (best on mobile), falls back to
  // clipboard, falls back to just showing the link to copy by hand.
  const shareAcceptLink = async () => {
    if (!initial?.id) return;
    const url = `${window.location.origin}/accept/${initial.id}`;
    setLinkFallback("");
    if (navigator.share) {
      try {
        await navigator.share({ title: `Quote ${initial.docNumber || ""} — Lyons Fencing`, text: "Here's your quote — tap to review and accept:", url });
        return;
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      setLinkFallback(url);
    }
  };

  useEffect(() => {
    if (initial?._autoPrefill) {
      setScanPrefill(initial._autoPrefill);
      setShowCalc(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Old fence removal length defaults to the overall job length, kept in sync unless you type over it.
  useEffect(() => {
    if (form.jobLength) set("removalLength", form.jobLength);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.jobLength]);

  const fuelCost = estFuelCost(form.distanceKm, settings);
  const labourRate = (LABOUR_RATES.find((r) => r.id === form.labourRateType) || LABOUR_RATES[0]).rate;
  const labourCost = (Number(form.employees) || 0) * (Number(form.hours) || 0) * labourRate;
  const tipRatePerMetre = Number(settings?.tipRatePerMetre) || 10;
  const tipCost = (Number(form.removalLength) || 0) * tipRatePerMetre;
  // Materials = whatever was added via "Calculate materials", plus fence templates' $/m x length (+ screws/nails for timber).
  const addedMaterials = Number(form.materialsCost) || 0;
  const templateMaterials = templateMaterialsCost(form.items, JOB_TEMPLATES, materials);

  // ----- change the length or height and the rest of the quote follows (lines, wording, rates, notes) -----
  const [adjusted, setAdjusted] = useState(null); // { changes, warnings, stale } shown under the fields
  const lastDims = useRef({ len: Number(form.jobLength) || 0, h: Number(form.fenceHeight) || 0 }); // the last real values, in case the box is cleared mid-typing
  const setDims = (patch) => {
    const r = adjustForDimensions(form, { ...patch, oldLength: lastDims.current.len, oldHeight: lastDims.current.h });
    if (patch.jobLength !== undefined && Number(patch.jobLength) > 0) lastDims.current.len = Number(patch.jobLength);
    if (patch.fenceHeight !== undefined && Number(patch.fenceHeight) > 0) lastDims.current.h = Number(patch.fenceHeight);
    setForm((cur) => ({ ...cur, ...patch, ...r.patch }));
    if (r.changes.length || r.warnings.length) {
      setAdjusted({ changes: r.changes, warnings: r.warnings, stale: (form.materialsBreakdown || []).length > 0 });
    }
  };
  // The shopping list was worked out for the old size: redo it for the new one.
  const recalcMaterials = () => {
    const input = materialsInputs(form);
    if (!input.style || !(Number(input.length) > 0)) return;
    const items = calcMaterials({ ...input, gateWidth: input.gateWidth || 1, materials });
    const total = itemsTotal(items);
    setForm((cur) => ({ ...cur, materialsBreakdown: items, ...(templateMaterials <= 0 ? { materialsCost: total } : {}) }));
    setAdjusted((a) => (a ? { ...a, stale: false, changes: [...a.changes, "shopping list recalculated"] } : a));
  };
  const materialsCost = addedMaterials + templateMaterials;
  const runningCosts = fuelCost + labourCost + tipCost + materialsCost;
  // GST-inclusive, to compare like-for-like with the costs above (materials are entered inc GST too).
  const quoteTotal = gstBreakdown(itemsTotal(form.items)).total;
  const addNote = (snippet) => set("notes", form.notes ? `${form.notes}\n${snippet}` : snippet);
  // Inserting a sleeper template drops the sleeper timber note in automatically (once).
  const handleTemplateInserted = (t) => {
    if (/sleeper/i.test(t.desc) && !(form.notes || "").includes(SLEEPER_NOTE)) addNote(SLEEPER_NOTE);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setScanError("");
    try {
      const result = await scanJobPhoto(file);
      setScanPrefill(result);
      setShowCalc(true);
    } catch (err) {
      setScanError(err.message || "Couldn't read that photo — try a clearer shot, or enter details manually.");
    } finally {
      setScanning(false);
      e.target.value = "";
    }
  };

  const handleEstimateRoute = async () => {
    if (!form.address) return;
    setEstimatingRoute(true);
    setRouteError("");
    try {
      const km = await estimateRouteDistance(form.address, form.jobType);
      if (km) set("distanceKm", km);
      else setRouteError("Couldn't work out a distance — enter it manually.");
    } catch (err) {
      setRouteError(`Couldn't work out a distance (${err.message || "unknown error"}) — enter it manually.`);
    } finally {
      setEstimatingRoute(false);
    }
  };

  return (
    <Modal title={initial?.id ? "Edit quote" : "New quote"} onClose={onClose}>
      <div className="field-pair">
        <Field label="Client"><input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} placeholder="Client name" /></Field>
        <Field label="Quote #"><input value={form.docNumber || ""} onChange={(e) => set("docNumber", e.target.value)} /></Field>
      </div>
      <div className="field-pair">
        <Field label="Client phone (for follow-up texts)"><input type="tel" value={form.clientPhone || ""} onChange={(e) => set("clientPhone", e.target.value)} placeholder="04xx xxx xxx" /></Field>
        <Field label="Client email (to send the quote)"><input type="email" value={form.clientEmail || ""} onChange={(e) => set("clientEmail", e.target.value)} placeholder="name@email.com" /></Field>
      </div>
      <Field label="Quote date (the quote is valid for 3 months from this date)"><input type="date" value={form.date || ""} onChange={(e) => set("date", e.target.value)} style={{ maxWidth: 200 }} /></Field>
      <div className="field-pair">
        <Field label="Job type">
          <select value={form.jobType} onChange={(e) => set("jobType", e.target.value)}>
            {JOB_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={form.status} onChange={(e) => changeStatus(e.target.value)}>
            {QUOTE_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      {form.acceptedByName && (
        <p className="calc-note">Digitally accepted by {form.acceptedByName} on {formatDateAU(form.acceptedAt)}.</p>
      )}
      {form.status === "Accepted" && (
        <Field label="Job start date">
          <input type="date" value={form.startDate || ""} onChange={(e) => { set("startDate", e.target.value); setAutoPlaced(false); }} />
        </Field>
      )}
      {form.status === "Accepted" && autoPlaced && form.startDate && (
        <p className="calc-note" style={{ marginTop: -6 }}>
          <Clock size={12} style={{ verticalAlign: "-2px" }} /> Placed automatically in the next free slot ({formatDateAU(form.startDate)}){wetDays && wetDays.size > 0 ? ", skipping wet days in the forecast" : ""}. Change the date if you want it somewhere else.
        </p>
      )}
      {form.status === "Accepted" && (
        <div className="deposit-prompt">
          {depositInvoice ? (
            <div className="deposit-prompt-text">
              <Check size={16} /> Deposit invoice {depositInvoice.docNumber} is already raised ({depositInvoice.status.toLowerCase()}).
            </div>
          ) : (
            <>
              <div className="deposit-prompt-text">
                <Receipt size={16} />
                <span>
                  Accepted — raise the deposit invoice now?{" "}
                  <strong>{money(gstBreakdown(itemsTotal(form.items) * ((Number(form.depositPercent) || 10) / 100)).total)} inc. GST</strong>
                  {" "}({Number(form.depositPercent) || 10}%), due before the job starts. This saves the quote as it is first.
                </span>
              </div>
              <button type="button" className="btn-primary" onClick={() => onCreateDeposit(form)} disabled={!form.clientName || form.items.length === 0}>
                <Receipt size={15} /> Create deposit invoice
              </button>
            </>
          )}
        </div>
      )}
      <Field label="Street address">
        <div className="calc-trigger-row">
          <input value={form.address || ""} onChange={(e) => set("address", e.target.value)} placeholder="e.g. 107 Leyte Ave" style={{ flex: 1 }} />
          <button type="button" className="btn-ghost small" onClick={handleFindSuburb} disabled={!form.address || lookingUpSuburb}>
            <MapPin size={14} /> {lookingUpSuburb ? "Finding…" : "Find suburb"}
          </button>
        </div>
      </Field>
      {suburbError && <p className="calc-note" style={{ color: "var(--bad)" }}>{suburbError}</p>}
      <Field label="Suburb, state, postcode"><input value={form.suburb || ""} onChange={(e) => set("suburb", e.target.value)} placeholder="e.g. Palm Beach QLD 4221" /></Field>
      <div className="field-pair">
        <Field label="Job length (m)"><input type="number" value={form.jobLength || ""} onChange={(e) => setDims({ jobLength: e.target.value })} placeholder="e.g. 25" /></Field>
        <Field label="Fence height (m)"><input type="number" step="0.1" value={form.fenceHeight || ""} onChange={(e) => setDims({ fenceHeight: e.target.value })} placeholder="e.g. 1.8" /></Field>
      </div>
      {adjusted && (adjusted.changes.length > 0 || adjusted.warnings.length > 0) && (
        <div className="draft-note-lite">
          {adjusted.changes.length > 0 && <p className="calc-note" style={{ color: "var(--good)", margin: "0 0 4px" }}><Check size={12} style={{ verticalAlign: "-2px" }} /> Updated for you: {adjusted.changes.join(" · ")}.</p>}
          {adjusted.warnings.map((w) => <p key={w} className="calc-note" style={{ color: "var(--bad)", margin: "0 0 4px" }}>{w}</p>)}
          {adjusted.stale && <p className="calc-note" style={{ margin: "0 0 4px" }}>The shopping list was worked out for the old size. <button type="button" className="link-btn" onClick={recalcMaterials}>Recalculate it</button></p>}
        </div>
      )}
      <Field label="Deposit (%)"><input type="number" value={form.depositPercent || ""} onChange={(e) => set("depositPercent", e.target.value)} style={{ maxWidth: 100 }} /></Field>

      <div className="panel duration-box">
        <div className="panel-head"><Clock size={16} /><span>Job time (for scheduling)</span></div>
        <div className="duration-estimate">
          <strong>{hoursLabel(est.hours)}</strong>
          <span>{estWhy ? ` — ${estWhy}` : ""}</span>
        </div>
        <div className="field-pair" style={{ marginTop: 10 }}>
          <Field label="Override the estimate (optional)">
            <input type="number" min="0" step="0.25" value={typedShown} onChange={(e) => setTyped(e.target.value)} placeholder={durUnit === "days" ? String(est.hours / HOURS_PER_DAY) : String(est.hours)} />
          </Field>
          <Field label="In">
            <select value={durUnit} onChange={(e) => setDurUnit(e.target.value)}>
              <option value="days">days</option>
              <option value="hours">hours</option>
            </select>
          </Field>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={worksSaturday(form)} onChange={(e) => set("workSaturday", e.target.checked ? "yes" : "")} />
          <span>This job can run over a Saturday</span>
        </label>
        {runDays.length > 0 && (
          <p className="calc-note" style={{ marginBottom: 0 }}>
            Runs {runDays.length === 1 ? formatDateAU(runDays[0].date) : `${formatDateAU(runDays[0].date)} → ${formatDateAU(runDays[runDays.length - 1].date)}`}
            {` (${runDays.length === 1 ? "1 day" : `${runDays.length} working days`})`}.
          </p>
        )}
      </div>

      {form._draft && (
        <div className="panel draft-note">
          <div className="panel-head"><ClipboardPaste size={16} /><span>Drafted from your site notes</span></div>
          <p style={{ margin: "0 0 6px" }}>{form._draft.summary.join(" · ")}</p>
          {form._draft.needsPrice.map((t) => <p key={t} className="calc-note" style={{ color: "var(--bad)", margin: "2px 0" }}>{t}</p>)}
          {form._draft.assumptions.length > 0 && (
            <ul className="draft-assume">
              {form._draft.assumptions.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}
          <p className="calc-note" style={{ margin: "6px 0 0" }}>These are a starting point from your notes, using your usual rates. Check the lines and the standard notes below, then save.</p>
        </div>
      )}

      <Field label="Line items">
        <p className="calc-note">This is what the client sees and pays — "Insert job template" below uses your job length and fence height automatically.</p>
        <LineItems items={form.items} setItems={setItems} defaultLength={form.jobLength} fenceHeight={form.fenceHeight} onInsertTemplate={handleTemplateInserted} />
      </Field>

      <div className="panel job-cost-panel">
        <div className="panel-head"><Wallet size={16} /><span>Your costs (not shown to client)</span></div>
        <p className="calc-note" style={{ marginBottom: 10 }}>Reference only — nothing here ever gets added to the quote itself, since your rates already have it baked in.</p>

        <div className="calc-trigger-row">
          <button type="button" className="btn-ghost small" onClick={() => { setScanPrefill(null); setShowCalc(true); }}>
            <Boxes size={14} /> Calculate materials
          </button>
          <button type="button" className="btn-ghost small" onClick={() => fileInputRef.current?.click()} disabled={scanning}>
            <Camera size={14} /> {scanning ? "Reading photo…" : "Scan job photo"}
          </button>
          <input type="file" accept="image/*" ref={fileInputRef} style={{ display: "none" }} onChange={handleFile} />
        </div>
        {scanError && <p className="calc-note" style={{ color: "var(--bad)" }}>{scanError}</p>}
        {templateMaterials > 0 && (
          <div className="fuel-note">
            <Boxes size={14} /> {money(templateMaterials)} in materials from your fence templates (length × your cost per metre{form.items.some((it) => JOB_TEMPLATES.find((j) => j.label === it.tpl)?.timberStyle) ? ", plus screws and nails" : ""}).
            "Calculate materials" still builds the shopping list but won't add to this.
          </div>
        )}
        {addedMaterials > 0 && (
          <div className="fuel-note">
            <Boxes size={14} /> {money(addedMaterials)} in extra materials added
            <button type="button" className="btn-ghost small" onClick={() => { set("materialsCost", 0); set("materialsBreakdown", []); }}>Clear</button>
          </div>
        )}

        <Field label="Distance (km, return trip)">
          <div className="calc-trigger-row">
            <input type="number" value={form.distanceKm || ""} onChange={(e) => set("distanceKm", e.target.value)} placeholder="e.g. 40" style={{ flex: 1 }} />
            <button type="button" className="btn-ghost small" onClick={handleEstimateRoute} disabled={!form.address || estimatingRoute}>
              <MapPin size={14} /> {estimatingRoute ? "Working it out…" : "Estimate"}
            </button>
          </div>
        </Field>
        {routeError && <p className="calc-note" style={{ color: "var(--bad)" }}>{routeError}</p>}
        <p className="calc-note" style={{ marginTop: -6, marginBottom: 10 }}>
          {form.jobType === "Colorbond"
            ? "Estimates the full loop: home (Tugun) → job → tip (Reedy Creek) → materials (Yatala) → job → home."
            : form.jobType === "Timber fencing"
            ? "Estimates the full loop: home (Tugun) → job → tip (Reedy Creek) → materials (Bunnings Burleigh) → job → home."
            : "Estimates a simple return trip from home (Tugun) to the job."}
        </p>
        <div className="field-pair">
          <Field label="Employees"><input type="number" value={form.employees || ""} onChange={(e) => set("employees", e.target.value)} placeholder="0" /></Field>
          <Field label="Hours on site"><input type="number" value={form.hours || ""} onChange={(e) => set("hours", e.target.value)} placeholder="e.g. 8" /></Field>
        </div>
        <Field label="Employee pay rate">
          <select value={form.labourRateType || LABOUR_RATES[0].id} onChange={(e) => set("labourRateType", e.target.value)}>
            {LABOUR_RATES.map((r) => <option key={r.id} value={r.id}>${r.rate}/hr {r.label}</option>)}
          </select>
        </Field>
        <Field label="Old timber fence removed (m)"><input type="number" value={form.removalLength || ""} onChange={(e) => set("removalLength", e.target.value)} placeholder="e.g. 25" /></Field>

        {runningCosts > 0 && (
          <>
            <div className="cashflow-row" style={{ marginTop: 10 }}>
              <div><div className="cf-label">Materials</div><div className="cf-value">{money(materialsCost)}</div></div>
              <div><div className="cf-label">Fuel</div><div className="cf-value">{money(fuelCost)}</div></div>
              <div><div className="cf-label">Labour</div><div className="cf-value">{money(labourCost)}</div></div>
              <div><div className="cf-label">Tipping</div><div className="cf-value">{money(tipCost)}</div></div>
            </div>
            <div className="job-cost-total"><span>Total running costs</span><span>{money(runningCosts)}</span></div>
            <div className="job-cost-total"><span>Quote total inc. GST (what you're charging)</span><span>{money(quoteTotal)}</span></div>
            <div className="job-cost-total job-cost-margin"><span>Estimated margin</span><span>{money(quoteTotal - runningCosts)}</span></div>
            <p className="calc-note" style={{ marginTop: 6 }}>
              Tipping estimated at ${tipRatePerMetre}/m of old timber fence removed.
            </p>
          </>
        )}
      </div>

      <Field label="Notes">
        <div className="calc-trigger-row">
          <button type="button" className="btn-primary small" onClick={() => {
            const suggested = suggestedNotes(form.jobType, form.jobLength, form.items);
            const existing = form.notes ? form.notes.split("\n").map((n) => n.trim()) : [];
            const merged = [...existing, ...suggested.filter((s) => !existing.includes(s))];
            set("notes", merged.join("\n"));
          }}>
            <Plus size={14} /> Insert standard notes for this job
          </button>
        </div>
        <div className="calc-trigger-row">
          {NOTE_SNIPPETS.map((s) => (
            <button type="button" key={s} className="btn-ghost small" onClick={() => addNote(s)}>+ {s.split(":")[0].slice(0, 22)}…</button>
          ))}
        </div>
        <textarea rows={4} value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder="Job-specific notes — tap a snippet above or type your own" />
      </Field>

      {showCalc && (
        <MaterialCalcModal
          materials={materials}
          prefill={scanPrefill}
          quoteDefaults={{
            style: form.jobType === "Aluminium fencing" ? "aluminium" : form.jobType === "Colorbond" ? "colorbond" : form.jobType === "Timber fencing" ? "timber" : undefined,
            slatWidth: materialsInputs(form).slatWidth,
            gateWidth: materialsInputs(form).gateWidth,
            length: form.jobLength || undefined,
            height: form.fenceHeight || undefined,
            raked: (form.items || []).some((it) => /raked/i.test(it.tpl || "")),
            sleeper: materialsInputs(form).sleeper,
            timberStyle: materialsInputs(form).timberStyle,
          }}
          onClose={() => { setShowCalc(false); setScanPrefill(null); }}
          onApply={(total, items) => {
            // When fence templates already cost the materials, the calculator only feeds the shopping list.
            if (templateMaterials <= 0) set("materialsCost", addedMaterials + total);
            set("materialsBreakdown", [...(form.materialsBreakdown || []), ...items]);
            setShowCalc(false);
            setScanPrefill(null);
          }}
        />
      )}

      <div className="modal-actions">
        {onDelete && <button className="btn-danger" onClick={onDelete}><Trash2 size={15} /> Delete</button>}
        {onDuplicate && <button className="btn-ghost" onClick={() => onDuplicate(form)}><Copy size={15} /> Duplicate</button>}
        {initial?.id && <button className="btn-ghost" onClick={shareAcceptLink}><Share2 size={15} /> {linkCopied ? "Link copied!" : "Send for acceptance"}</button>}
        {onFinalInvoice && <button className="btn-ghost" onClick={onFinalInvoice}><Receipt size={15} /> Create final invoice</button>}
        <button className="btn-ghost" onClick={() => setShowPreview(true)}><FileText size={15} /> Preview & PDF</button>
        {initial?.id && <button className="btn-ghost" onClick={() => setShowEmail(true)} title="Emails the saved quote with the PDF attached"><Mail size={15} /> Email quote</button>}
        <button className="btn-primary" onClick={() => onSave(form)} disabled={!form.clientName}><Check size={15} /> Save</button>
      </div>
      {linkFallback && (
        <p className="calc-note" style={{ padding: "0 18px 16px" }}>Couldn't copy automatically — here's the link to send: <strong style={{ userSelect: "all" }}>{linkFallback}</strong></p>
      )}

      {showPreview && <DocumentPreviewModal type="quote" data={form} onClose={() => setShowPreview(false)} />}
      {showEmail && <EmailModal kind="quote" id={initial.id} title="Email the quote" onClose={() => setShowEmail(false)} onSent={() => setForm((f) => (f.status === "Draft" ? { ...f, status: "Sent" } : f))} />}
    </Modal>
  );
}

// ---------- Invoices ----------
function Invoices({ invoices, setInvoices, settings, bumpDocNumber }) {
  const [modal, setModal] = useState(null);
  const previewNumber = () => `LFS${settings?.nextDocNumber || 458}`;

  const save = (data) => {
    if (data.id && invoices.some((i) => i.id === data.id)) setInvoices((is) => is.map((i) => (i.id === data.id ? data : i)));
    else {
      bumpDocNumber();
      setInvoices((is) => [{ ...data, id: uid(), issuedDate: data.issuedDate || today() }, ...is]);
    }
    setModal(null);
  };
  const remove = (id) => setInvoices((is) => is.filter((i) => i.id !== id));
  const markPaid = (inv) => setInvoices((is) => is.map((i) => (i.id === inv.id ? { ...i, status: "Paid", paidDate: today() } : i)));

  const effectiveStatus = (i) => (i.status === "Unpaid" && i.dueDate && i.dueDate < today() ? "Overdue" : i.status);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  // The Overdue filter matches what the list shows (an unpaid invoice past its due date), not just the stored status.
  const visibleInvoices = invoices.filter((i) => (!statusFilter || effectiveStatus(i) === statusFilter) && matchesQuery(invoiceText(i), query));

  return (
    <div>
      <div className="section-head row">
        <div>
          <h1>Invoices</h1>
          <p>What's been billed, and what's still owing.</p>
        </div>
        <button className="btn-primary" onClick={() => setModal({ mode: "new", data: { items: [], status: "Unpaid", docNumber: previewNumber() } })}>
          <Plus size={16} /> New invoice
        </button>
      </div>

      {invoices.length > 0 && (
        <SearchBar value={query} onChange={setQuery} placeholder="Search invoices — name, number, address, amount…" shown={visibleInvoices.length} total={invoices.length}>
          <select className="search-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {INVOICE_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </SearchBar>
      )}
      {invoices.length === 0 ? (
        <EmptyState icon={Receipt} title="No invoices yet" hint="Raise one directly, or convert an accepted quote from the Quotes tab." onAdd={() => setModal({ mode: "new", data: { items: [], status: "Unpaid", docNumber: previewNumber() } })} addLabel="Add invoice" />
      ) : visibleInvoices.length === 0 ? (
        <p className="calc-note" style={{ textAlign: "center", padding: "24px 0" }}>No invoices match "{query}"{statusFilter ? ` with status ${statusFilter}` : ""}.</p>
      ) : (
        <div className="list">
          {visibleInvoices.map((i) => (
            <div className="row-card" key={i.id} onClick={() => setModal({ mode: "edit", data: i })}>
              <div className="row-card-main">
                <div className="row-card-title">{i.clientName || "Untitled"}{isDepositInvoice(i) && <span className="doc-kind-badge">Deposit invoice</span>}</div>
                <div className="row-card-meta">{money(itemsTotal(i.items))} + GST = {money(gstBreakdown(itemsTotal(i.items)).total)} · issued {i.issuedDate}{i.dueDate ? ` · due ${i.dueDate}` : ""}</div>
              </div>
              <Tag label={effectiveStatus(i)} />
            </div>
          ))}
        </div>
      )}

      {modal && (
        <InvoiceModal
          initial={modal.data}
          onClose={() => setModal(null)}
          onSave={save}
          onDelete={modal.data?.id ? () => { remove(modal.data.id); setModal(null); } : null}
          onMarkPaid={modal.data?.id && modal.data.status !== "Paid" ? () => { markPaid(modal.data); setModal(null); } : null}
        />
      )}
    </div>
  );
}

function InvoiceModal({ initial, onClose, onSave, onDelete, onMarkPaid }) {
  const [showEmail, setShowEmail] = useState(false);
  const [form, setForm] = useState({ clientName: "", address: "", suburb: "", jobType: "", items: [], status: "Unpaid", issuedDate: today(), dueDate: "", docNumber: "", notes: "", ...initial });
  const [showPreview, setShowPreview] = useState(false);
  const [lookingUpSuburb, setLookingUpSuburb] = useState(false);
  const [suburbError, setSuburbError] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItems = (updater) => setForm((f) => ({ ...f, items: typeof updater === "function" ? updater(f.items) : updater }));
  const addNote = (snippet) => set("notes", form.notes ? `${form.notes}\n${snippet}` : snippet);

  const handleFindSuburb = async () => {
    if (!form.address) return;
    setLookingUpSuburb(true);
    setSuburbError("");
    try {
      const suburb = await lookupSuburb(form.address);
      set("suburb", suburb);
    } catch (err) {
      setSuburbError(err.message || "Couldn't find that address — enter the suburb manually.");
    } finally {
      setLookingUpSuburb(false);
    }
  };

  return (
    <Modal title={`${initial?.id ? "Edit" : "New"} ${isDepositInvoice(form) ? "deposit invoice" : "invoice"}`} onClose={onClose}>
      <div className="field-pair">
        <Field label="Client"><input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} placeholder="Client name" /></Field>
        <Field label="Invoice #"><input value={form.docNumber || ""} onChange={(e) => set("docNumber", e.target.value)} /></Field>
      </div>
      <Field label="Client email (to send the invoice)"><input type="email" value={form.clientEmail || ""} onChange={(e) => set("clientEmail", e.target.value)} placeholder="name@email.com" /></Field>
      <Field label="Street address">
        <div className="calc-trigger-row">
          <input value={form.address || ""} onChange={(e) => set("address", e.target.value)} placeholder="e.g. 107 Leyte Ave" style={{ flex: 1 }} />
          <button type="button" className="btn-ghost small" onClick={handleFindSuburb} disabled={!form.address || lookingUpSuburb}>
            <MapPin size={14} /> {lookingUpSuburb ? "Finding…" : "Find suburb"}
          </button>
        </div>
      </Field>
      {suburbError && <p className="calc-note" style={{ color: "var(--bad)" }}>{suburbError}</p>}
      <Field label="Suburb, state, postcode"><input value={form.suburb || ""} onChange={(e) => set("suburb", e.target.value)} placeholder="e.g. Palm Beach QLD 4221" /></Field>
      <div className="field-pair">
        <Field label="Issued"><input type="date" value={form.issuedDate || ""} onChange={(e) => set("issuedDate", e.target.value)} /></Field>
        <Field label="Due"><input type="date" value={form.dueDate || ""} onChange={(e) => set("dueDate", e.target.value)} /></Field>
      </div>
      <Field label="Status">
        <select value={form.status} onChange={(e) => set("status", e.target.value)}>
          {INVOICE_STATUSES.filter((s) => s !== "Overdue").map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Line items"><LineItems items={form.items} setItems={setItems} /></Field>

      <Field label="Notes">
        <div className="calc-trigger-row">
          {NOTE_SNIPPETS.map((s) => (
            <button type="button" key={s} className="btn-ghost small" onClick={() => addNote(s)}>+ {s.split(":")[0].slice(0, 22)}…</button>
          ))}
        </div>
        <textarea rows={3} value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder="Job-specific notes for this invoice" />
      </Field>

      <div className="modal-actions">
        {onDelete && <button className="btn-danger" onClick={onDelete}><Trash2 size={15} /> Delete</button>}
        {onMarkPaid && <button className="btn-ghost" onClick={onMarkPaid}><Check size={15} /> Mark paid</button>}
        <button className="btn-ghost" onClick={() => setShowPreview(true)}><FileText size={15} /> Preview & PDF</button>
        {initial?.id && <button className="btn-ghost" onClick={() => setShowEmail(true)} title="Emails the saved invoice with the PDF attached"><Mail size={15} /> Email invoice</button>}
        <button className="btn-primary" onClick={() => onSave(form)} disabled={!form.clientName}><Check size={15} /> Save</button>
      </div>

      {showPreview && <DocumentPreviewModal type="invoice" data={form} onClose={() => setShowPreview(false)} />}
      {showEmail && <EmailModal kind="invoice" id={initial.id} title="Email the invoice" onClose={() => setShowEmail(false)} />}
    </Modal>
  );
}

function BulkImportQuotesModal({ onClose, onApply }) {
  const [text, setText] = useState("[]");
  const [error, setError] = useState("");

  const parsed = useMemo(() => {
    try {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) return null;
      return arr;
    } catch {
      return null;
    }
  }, [text]);

  useEffect(() => {
    setError(parsed ? "" : "Couldn't read that as valid JSON — check for a stray comma or bracket.");
  }, [parsed]);

  const handleImport = () => {
    if (!parsed) return;
    const withIds = parsed.map((q) => ({
      ...q,
      id: uid(),
      items: (q.items || []).map((it) => ({ ...it, id: uid() })),
    }));
    onApply(withIds);
  };

  return (
    <Modal title="Bulk import quotes" onClose={onClose}>
      <p className="calc-note">
        Paste a JSON array of quotes (same shape as the export file's "quotes" list) and import them in one go.
      </p>
      <Field label={`Quotes (${parsed ? parsed.length : 0} detected)`}>
        <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} className="bulk-textarea" />
      </Field>
      {error && <p className="calc-note" style={{ color: "var(--bad)" }}>{error}</p>}
      <div className="modal-actions">
        <button className="btn-primary" disabled={!parsed || parsed.length === 0} onClick={handleImport}>
          <Plus size={15} /> Import {parsed ? parsed.length : 0} quotes
        </button>
      </div>
    </Modal>
  );
}

function BulkAddMaterialsModal({ onClose, onApply }) {
  const [text, setText] = useState(PRESET_MATERIALS);

  const parsed = useMemo(() => {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, cost, unit, packQty] = line.split(",").map((s) => s.trim());
        if (!name) return null;
        return { name, costPerUnit: Number(cost) || 0, unit: unit || "each", packQty: Number(packQty) || 1 };
      })
      .filter(Boolean);
  }, [text]);

  return (
    <Modal title="Bulk add materials" onClose={onClose}>
      <p className="calc-note">
        One per line: <strong>name, cost, unit</strong> — or <strong>name, cost, unit, qty per pack</strong> for
        things bought by the box (like screws or nails), so the calculator can work out cost per item. Pre-filled
        with pricing from your screenshots — check it over, add/remove lines, then import. Qty on hand and reorder
        level default to 0, so set those afterwards for anything you want stock alerts on.
      </p>
      <Field label={`Materials (${parsed.length} detected)`}>
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} className="bulk-textarea" />
      </Field>
      <div className="modal-actions">
        <button className="btn-primary" disabled={parsed.length === 0} onClick={() => onApply(parsed)}>
          <Plus size={15} /> Import {parsed.length} materials
        </button>
      </div>
    </Modal>
  );
}

// ---------- Materials ----------
function Materials({ materials, setMaterials }) {
  const [modal, setModal] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const save = (data) => {
    if (data.id) setMaterials((ms) => ms.map((m) => (m.id === data.id ? data : m)));
    else setMaterials((ms) => [{ ...data, id: uid() }, ...ms]);
    setModal(null);
  };
  const remove = (id) => setMaterials((ms) => ms.filter((m) => m.id !== id));
  const applyBulk = (parsed) => {
    const newOnes = parsed.map((p) => ({
      id: uid(), name: p.name, unit: p.unit, costPerUnit: p.costPerUnit, packQty: p.packQty || 1, qtyOnHand: 0, reorderLevel: 0, supplier: "",
    }));
    setMaterials((ms) => [...newOnes, ...ms]);
    setBulkOpen(false);
  };

  return (
    <div>
      <div className="section-head row">
        <div>
          <h1>Materials</h1>
          <p>Stock on hand — posts, panels, concrete, fixings, whatever you track.</p>
        </div>
        <div className="btn-stack">
          <button className="btn-ghost" onClick={() => setBulkOpen(true)}>
            <ClipboardPaste size={16} /> Bulk add
          </button>
          <button className="btn-primary" onClick={() => setModal({ mode: "new" })}>
            <Plus size={16} /> New material
          </button>
        </div>
      </div>

      {materials.length === 0 ? (
        <EmptyState icon={Boxes} title="No materials tracked" hint="Add the stock items you reorder often to catch low levels before a job stalls." onAdd={() => setModal({ mode: "new" })} addLabel="Add material" />
      ) : (
        <div className="list">
          {materials.map((m) => {
            const low = Number(m.reorderLevel) > 0 && Number(m.qtyOnHand) <= Number(m.reorderLevel);
            return (
              <div className="row-card" key={m.id} onClick={() => setModal({ mode: "edit", data: m })}>
                <div className="row-card-main">
                  <div className="row-card-title">{m.name}</div>
                  <div className="row-card-meta">{m.qtyOnHand} {m.unit} on hand · reorder at {m.reorderLevel} · {money(m.costPerUnit)}/{m.unit}</div>
                </div>
                {low && <Tag label="Low stock" />}
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <MaterialModal
          initial={modal.data}
          onClose={() => setModal(null)}
          onSave={save}
          onDelete={modal.data ? () => { remove(modal.data.id); setModal(null); } : null}
        />
      )}
      {bulkOpen && <BulkAddMaterialsModal onClose={() => setBulkOpen(false)} onApply={applyBulk} />}
    </div>
  );
}

function MaterialModal({ initial, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(initial || { name: "", unit: "each", qtyOnHand: 0, reorderLevel: 0, costPerUnit: 0, packQty: 1, supplier: "" });
  const [priceCheck, setPriceCheck] = useState({ loading: false, result: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const perItem = Number(form.costPerUnit) / (Number(form.packQty) || 1);

  const runPriceCheck = async () => {
    setPriceCheck({ loading: true, result: "" });
    try {
      const result = await lookupPrice(form.name);
      setPriceCheck({ loading: false, result });
    } catch (err) {
      setPriceCheck({ loading: false, result: err.message || "Couldn't fetch a price right now — try again shortly." });
    }
  };

  return (
    <Modal title={initial ? "Edit material" : "New material"} onClose={onClose}>
      <Field label="Name"><input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Treated pine post 125x125" /></Field>
      <div className="field-pair">
        <Field label="Unit"><input value={form.unit || ""} onChange={(e) => set("unit", e.target.value)} placeholder="each / m / bag / box" /></Field>
        <Field label="Cost per unit"><input type="number" value={form.costPerUnit ?? ""} onChange={(e) => set("costPerUnit", e.target.value)} /></Field>
      </div>
      <Field label="Qty per pack (only if bought by box — e.g. 500 screws in a box)">
        <input type="number" value={form.packQty ?? ""} onChange={(e) => set("packQty", e.target.value)} placeholder="1" />
      </Field>
      {Number(form.packQty) > 1 && (
        <p className="calc-note">Works out to {money(perItem)} per item — that's what the material calculator will use.</p>
      )}
      <button type="button" className="btn-ghost small" disabled={!form.name || priceCheck.loading} onClick={runPriceCheck}>
        {priceCheck.loading ? "Checking…" : "Check current price online"}
      </button>
      {priceCheck.result && (
        <div className="price-check">
          <p>{priceCheck.result}</p>
          <span className="price-check-note">Estimate from a web search — confirm with your supplier before quoting.</span>
        </div>
      )}
      <div className="field-pair">
        <Field label="Qty on hand"><input type="number" value={form.qtyOnHand ?? ""} onChange={(e) => set("qtyOnHand", e.target.value)} /></Field>
        <Field label="Reorder level"><input type="number" value={form.reorderLevel ?? ""} onChange={(e) => set("reorderLevel", e.target.value)} /></Field>
      </div>
      <Field label="Supplier"><input value={form.supplier || ""} onChange={(e) => set("supplier", e.target.value)} placeholder="Where you buy this" /></Field>

      <div className="modal-actions">
        {onDelete && <button className="btn-danger" onClick={onDelete}><Trash2 size={15} /> Delete</button>}
        <button className="btn-primary" onClick={() => onSave(form)} disabled={!form.name}><Check size={15} /> Save</button>
      </div>
    </Modal>
  );
}

// ---------- Shopping list (materials needed, per job) ----------
function ShoppingList({ quotes, go }) {
  const jobs = quotes
    .filter((q) => q.status === "Accepted")
    .sort((a, b) => {
      if (a.startDate && b.startDate) return a.startDate.localeCompare(b.startDate);
      if (a.startDate) return -1;
      if (b.startDate) return 1;
      return 0;
    });

  return (
    <div>
      <div className="section-head">
        <h1>Shopping list</h1>
        <p>Materials to buy for each upcoming job — one list per job, from the material calculator on each quote.</p>
      </div>

      {jobs.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="No upcoming jobs" hint="Accepted quotes with a materials breakdown show up here, one list per job." />
      ) : (
        <div className="list">
          {jobs.map((q) => {
            const breakdown = q.materialsBreakdown || [];
            const total = itemsTotal(breakdown);
            return (
              <div className="panel" key={q.id}>
                <div className="panel-head">
                  <Boxes size={16} />
                  <span>{q.clientName || "Untitled"} — {q.jobType}{q.startDate ? ` · starts ${formatDateAU(q.startDate)}` : ""}</span>
                </div>
                {breakdown.length === 0 ? (
                  <p className="calc-note">
                    No materials breakdown yet — open this quote and use "Calculate materials" to populate a shopping list.{" "}
                    <button type="button" className="btn-ghost small" onClick={() => go("quotes")}>Go to Quotes</button>
                  </p>
                ) : (
                  <div className="calc-preview">
                    {breakdown.map((it) => (
                      <div key={it.id} className="calc-row"><span>{it.desc} × {it.qty}</span><span>{money(Number(it.qty) * Number(it.rate))}</span></div>
                    ))}
                    <div className="calc-row calc-row-total"><span>Job total</span><span>{money(total)}</span></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Clients ----------
function Clients({ leads, quotes, invoices, go }) {
  const clientMap = useMemo(() => {
    const map = {};
    const touch = (name) => {
      if (!name) return null;
      if (!map[name]) map[name] = { name, addresses: new Set(), quotes: [], invoices: [], leadStatus: null };
      return map[name];
    };
    leads.forEach((l) => {
      const c = touch(l.name);
      if (!c) return;
      if (l.address) c.addresses.add(l.address);
      c.leadStatus = l.status;
    });
    quotes.forEach((q) => {
      const c = touch(q.clientName);
      if (!c) return;
      const full = [q.address, q.suburb].filter(Boolean).join(", ");
      if (full) c.addresses.add(full);
      c.quotes.push(q);
    });
    invoices.forEach((i) => {
      const c = touch(i.clientName);
      if (!c) return;
      const full = [i.address, i.suburb].filter(Boolean).join(", ");
      if (full) c.addresses.add(full);
      c.invoices.push(i);
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [leads, quotes, invoices]);

  const statusFor = (c) => {
    const accepted = c.quotes.find((q) => q.status === "Accepted");
    if (accepted) return { label: accepted.startDate ? `Yes — starts ${formatDateAU(accepted.startDate)}` : "Yes — no date set", tone: "good" };
    if (c.quotes.some((q) => q.status === "Sent")) return { label: "Awaiting response", tone: "" };
    if (c.quotes.some((q) => q.status === "Declined")) return { label: "Declined", tone: "bad" };
    if (c.leadStatus) return { label: c.leadStatus, tone: "" };
    return { label: "—", tone: "" };
  };

  return (
    <div>
      <div className="section-head">
        <h1>Clients</h1>
        <p>Every client pulled together from leads, quotes and invoices — no separate data entry.</p>
      </div>

      {clientMap.length === 0 ? (
        <EmptyState icon={UserCircle} title="No clients yet" hint="Clients show up here automatically once you add a lead or quote." />
      ) : (
        <div className="list">
          {clientMap.map((c) => {
            const st = statusFor(c);
            const quotedTotal = c.quotes.reduce((s, q) => s + itemsTotal(q.items), 0);
            const invoicedTotal = c.invoices.reduce((s, i) => s + itemsTotal(i.items), 0);
            const paidTotal = c.invoices.filter((i) => i.status === "Paid").reduce((s, i) => s + itemsTotal(i.items), 0);
            return (
              <div className="row-card client-card" key={c.name} onClick={() => go("quotes")}>
                <div className="row-card-main">
                  <div className="row-card-title">{c.name}</div>
                  <div className="row-card-meta">
                    {[...c.addresses][0] || "No address on file"} · {c.quotes.length} quote{c.quotes.length === 1 ? "" : "s"}
                    {c.invoices.length > 0 ? ` · ${c.invoices.length} invoice${c.invoices.length === 1 ? "" : "s"}` : ""}
                  </div>
                  <div className="row-card-meta">
                    Quoted {money(gstBreakdown(quotedTotal).total)} inc. GST{invoicedTotal > 0 ? ` · Invoiced ${money(gstBreakdown(invoicedTotal).total)} (${money(gstBreakdown(paidTotal).total)} paid)` : ""}
                  </div>
                </div>
                <Tag label={st.label} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Finances ----------
function Finances({ invoices, expenses, setExpenses, quotes, settings }) {
  const [modal, setModal] = useState(null);

  const save = (data) => {
    if (data.id) setExpenses((es) => es.map((e) => (e.id === data.id ? data : e)));
    else setExpenses((es) => [{ ...data, id: uid() }, ...es]);
    setModal(null);
  };
  const remove = (id) => setExpenses((es) => es.filter((e) => e.id !== id));

  const paidInvoices = invoices.filter((i) => i.status === "Paid");
  // Income shown inc. GST, since expenses are logged as the GST-inclusive amount
  // off a receipt — comparing ex-GST income to inc-GST expenses understated
  // revenue against costs.
  const totalIncome = paidInvoices.reduce((s, i) => s + gstBreakdown(itemsTotal(i.items)).total, 0);
  const totalExpense = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const actualFuelSpend = expenses.filter((e) => e.category === "Fuel").reduce((s, e) => s + Number(e.amount || 0), 0);
  const estimatedFuelAcrossQuotes = (quotes || []).reduce((s, q) => s + estFuelCost(q.distanceKm, settings), 0);

  const byMonth = useMemo(() => {
    const map = {};
    paidInvoices.forEach((i) => {
      const m = (i.paidDate || i.issuedDate || "").slice(0, 7);
      if (!m) return;
      map[m] = map[m] || { income: 0, expense: 0 };
      map[m].income += gstBreakdown(itemsTotal(i.items)).total;
    });
    expenses.forEach((e) => {
      const m = (e.date || "").slice(0, 7);
      if (!m) return;
      map[m] = map[m] || { income: 0, expense: 0 };
      map[m].expense += Number(e.amount || 0);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, expenses]);

  const maxVal = Math.max(1, ...byMonth.flatMap(([, v]) => [v.income, v.expense]));

  return (
    <div>
      <div className="section-head row">
        <div>
          <h1>Finances</h1>
          <p>Paid income against logged expenses.</p>
        </div>
        <button className="btn-primary" onClick={() => setModal({ mode: "new", data: { date: today(), category: EXPENSE_CATEGORIES[0] } })}>
          <Plus size={16} /> Log expense
        </button>
      </div>

      <div className="card-grid three">
        <div className="stat-card static">
          <TrendingUp size={20} />
          <div className="stat-value good">{money(totalIncome)}</div>
          <div className="stat-label">Total income (paid, inc. GST)</div>
        </div>
        <div className="stat-card static">
          <TrendingDown size={20} />
          <div className="stat-value bad">{money(totalExpense)}</div>
          <div className="stat-label">Total expenses (inc. GST)</div>
        </div>
        <div className="stat-card static">
          <Wallet size={20} />
          <div className={`stat-value ${totalIncome - totalExpense >= 0 ? "good" : "bad"}`}>{money(totalIncome - totalExpense)}</div>
          <div className="stat-label">Net</div>
        </div>
      </div>

      {byMonth.length > 0 && (
        <div className="panel">
          <div className="panel-head"><span>Last {byMonth.length} months</span></div>
          <div className="chart">
            {byMonth.map(([m, v]) => (
              <div className="chart-col" key={m}>
                <div className="chart-bars">
                  <div className="bar income" style={{ height: `${(v.income / maxVal) * 100}%` }} title={money(v.income)} />
                  <div className="bar expense" style={{ height: `${(v.expense / maxVal) * 100}%` }} title={money(v.expense)} />
                </div>
                <div className="chart-label">{m.slice(5)}/{m.slice(2, 4)}</div>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span><i className="dot income" /> Income</span>
            <span><i className="dot expense" /> Expenses</span>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><Fuel size={16} /><span>Fuel</span></div>
        <div className="cashflow-row">
          <div>
            <div className="cf-label">Logged fuel spend</div>
            <div className="cf-value bad">{money(actualFuelSpend)}</div>
          </div>
          <div>
            <div className="cf-label">Estimated across quoted jobs</div>
            <div className="cf-value">{money(estimatedFuelAcrossQuotes)}</div>
          </div>
        </div>
        <p className="calc-note" style={{ marginTop: 8 }}>
          "Logged" is what you've entered as Fuel expenses below. "Estimated" is worked out from the distance you enter on each quote — set it in Materials & fuel settings (gear icon, top right).
        </p>
      </div>

      <h2 className="sub-head">Expenses</h2>
      {expenses.length === 0 ? (
        <EmptyState icon={Wallet} title="No expenses logged" hint="Log fuel, materials, tools and other costs as they happen." onAdd={() => setModal({ mode: "new", data: { date: today(), category: EXPENSE_CATEGORIES[0] } })} addLabel="Log expense" />
      ) : (
        <div className="list">
          {expenses.map((e) => (
            <div className="row-card" key={e.id} onClick={() => setModal({ mode: "edit", data: e })}>
              <div className="row-card-main">
                <div className="row-card-title">{e.description || e.category}</div>
                <div className="row-card-meta">{e.category} · {e.date}</div>
              </div>
              <span className="expense-amt">{money(e.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <ExpenseModal
          initial={modal.data}
          onClose={() => setModal(null)}
          onSave={save}
          onDelete={modal.data?.id ? () => { remove(modal.data.id); setModal(null); } : null}
        />
      )}
    </div>
  );
}

function ExpenseModal({ initial, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({ description: "", category: EXPENSE_CATEGORIES[0], amount: "", date: today(), ...initial });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // "Scan receipt": the photo is read on this phone (nothing is uploaded) and the form is filled in for you to check.
  const [scan, setScan] = useState({ state: "idle", progress: 0, notes: [] });
  const receiptInput = useRef(null);
  const onReceipt = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setScan({ state: "reading", progress: 0, notes: [] });
    try {
      const text = await readReceipt(file, (p) => setScan((s) => ({ ...s, progress: p })));
      const r = parseReceipt(text);
      setForm((f) => ({
        ...f,
        ...(r.amount != null ? { amount: String(r.amount) } : {}),
        ...(r.date ? { date: r.date } : {}),
        category: r.category,
        description: r.description || f.description,
      }));
      setScan({ state: "done", progress: 1, notes: r.notes, found: r.amount != null });
    } catch (err) {
      setScan({ state: "error", progress: 0, notes: [], message: err.message || "Couldn't read that photo." });
    }
  };

  return (
    <Modal title={initial?.id ? "Edit expense" : "Log expense"} onClose={onClose}>
      {!initial?.id && (
        <div className="receipt-scan">
          <input ref={receiptInput} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onReceipt} />
          <button type="button" className="btn-primary" onClick={() => receiptInput.current?.click()} disabled={scan.state === "reading"}>
            <Camera size={15} /> {scan.state === "reading" ? `Reading receipt… ${Math.round((scan.progress || 0) * 100)}%` : "Scan receipt"}
          </button>
          {scan.state === "idle" && <span className="calc-note" style={{ margin: 0 }}>Photo of a fuel or tip receipt fills this in. The first time takes a little longer.</span>}
          {scan.state === "done" && (
            <span className="calc-note" style={{ margin: 0, color: scan.found ? "var(--good)" : "var(--bad)" }}>
              {scan.found ? "Filled in from the photo — check the amount and date before saving." : "Couldn't find the total on that photo."} {scan.notes.join(" ")}
            </span>
          )}
          {scan.state === "error" && <span className="calc-note" style={{ margin: 0, color: "var(--bad)" }}>{scan.message} You can still type it in.</span>}
        </div>
      )}
      <Field label="Description"><input value={form.description || ""} onChange={(e) => set("description", e.target.value)} placeholder="What was it for?" /></Field>
      <div className="field-pair">
        <Field label="Category">
          <select value={form.category} onChange={(e) => set("category", e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Amount"><input type="number" value={form.amount ?? ""} onChange={(e) => set("amount", e.target.value)} /></Field>
      </div>
      <Field label="Date"><input type="date" value={form.date || ""} onChange={(e) => set("date", e.target.value)} /></Field>

      <div className="modal-actions">
        {onDelete && <button className="btn-danger" onClick={onDelete}><Trash2 size={15} /> Delete</button>}
        <button className="btn-primary" onClick={() => onSave(form)} disabled={!form.amount}><Check size={15} /> Save</button>
      </div>
    </Modal>
  );
}

// Private calendar feed for the iPhone — see app/api/calendar and lib/calendarFeed.js.
// Keeps the hub and the Google Calendar in step while the hub is open (only if Google Calendar has been set up).
// Runs when the hub opens, when you come back to it, every couple of minutes, and a few seconds after a save.
// When the phone changed something, the lists reload so you see it.
function GoogleSyncRunner() {
  useEffect(() => {
    let off = false;
    let enabled = false;
    let busy = false;
    let timer = null;
    const sync = async () => {
      if (off || !enabled || busy || document.hidden) return;
      busy = true;
      try {
        const r = await fetch("/api/calendar/sync", { method: "POST" });
        const b = await r.json().catch(() => ({}));
        if (b.pulled > 0) window.dispatchEvent(new Event("hub-refresh"));
      } catch {
        // offline: next time
      } finally {
        busy = false;
      }
    };
    const soon = (e) => {
      const t = e?.detail?.table;
      if (t && !["leads", "quotes", "invoices"].includes(t)) return;
      clearTimeout(timer);
      timer = setTimeout(sync, 5000);
    };
    fetch("/api/calendar/sync", { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => { enabled = !!b.configured; if (enabled) sync(); })
      .catch(() => {});
    const every = setInterval(sync, 120000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("hub-save", soon);
    return () => {
      off = true;
      clearInterval(every);
      clearTimeout(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("hub-save", soon);
    };
  }, []);
  return null;
}

// Pulls in new leads from the business inbox while the hub is open: hipages job-details emails, and people emailing about a fence (see
// app/api/leads/inbox). Read-only. Checks on opening, on coming back, and every few minutes.
function InboxRunner() {
  useEffect(() => {
    let off = false;
    let enabled = false;
    let busy = false;
    const check = async () => {
      if (off || !enabled || busy || document.hidden) return;
      busy = true;
      try {
        const r = await fetch("/api/leads/inbox", { method: "POST" });
        const b = await r.json().catch(() => ({}));
        if (b.created > 0 || b.updated > 0) window.dispatchEvent(new Event("hub-refresh"));
      } catch {
        // offline: next time
      } finally {
        busy = false;
      }
    };
    fetch("/api/leads/inbox", { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => { enabled = !!b.configured; if (enabled) check(); })
      .catch(() => {});
    const every = setInterval(check, 180000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      off = true;
      clearInterval(every);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return null;
}

function GoogleSyncPanel() {
  const [status, setStatus] = useState(null); // { configured, connected, name, error, serviceAccount }
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const load = (check) =>
    fetch(`/api/calendar/sync${check ? "?check=1" : ""}`, { cache: "no-store" }).then((r) => r.json()).then(setStatus).catch(() => setStatus({ configured: false }));
  useEffect(() => { load(true); }, []);
  const syncNow = async () => {
    setBusy(true);
    setResult("");
    try {
      const r = await fetch("/api/calendar/sync", { method: "POST" });
      const b = await r.json();
      if (b.error) setResult(b.error);
      else if (b.busy) setResult("A sync is already running — give it a moment.");
      else {
        const bits = [b.created && `${b.created} added`, b.updated && `${b.updated} updated`, b.removed && `${b.removed} removed`, b.pulled && `${b.pulled} changed from your phone`].filter(Boolean);
        setResult(`Synced — ${bits.length ? bits.join(", ") : "everything was already up to date"}.${b.errors?.length ? ` Problems: ${b.errors.join("; ")}` : ""}`);
        if (b.pulled > 0) window.dispatchEvent(new Event("hub-refresh"));
      }
    } catch {
      setResult("Couldn't reach the hub just now.");
    } finally {
      setBusy(false);
    }
  };
  if (!status) return null;
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="panel-head"><CalendarDays size={16} /><span>Two-way sync (Google Calendar)</span></div>
      {!status.configured ? (
        <p className="calc-note" style={{ margin: 0 }}>
          Not set up yet. With it on, a date you change in your iPhone Calendar changes in the hub too (and the other way round). It needs a one-off Google setup — the steps are in the README, or ask Claude to walk you through them.
        </p>
      ) : (
        <>
          <p className="calc-note" style={{ marginTop: 0 }}>
            {status.connected === false ? <span style={{ color: "var(--bad)" }}>Set up, but can't connect: {status.error}</span> : status.connected ? <>Connected to the calendar “{status.name}”. Move a job, visit or due date on your iPhone and the hub follows within a couple of minutes (while it's open); move it in the hub and the calendar follows.</> : "Checking…"}
          </p>
          <div className="calc-trigger-row">
            <button className="btn-primary small" onClick={syncNow} disabled={busy}>{busy ? "Syncing…" : "Sync now"}</button>
          </div>
          {result && <p className="calc-note" style={{ marginBottom: 0 }}>{result}</p>}
        </>
      )}
    </div>
  );
}

function CalendarModal({ onClose }) {
  const [links, setLinks] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/calendar/link")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("The calendar isn't set up on this site yet."))))
      .then(setLinks)
      .catch((e) => setError(e.message));
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(links.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the link is in the box below to copy by hand.
    }
  };

  return (
    <Modal title="iPhone calendar" onClose={onClose}>
      <p className="calc-note">
        Subscribe once and these show up in your iPhone Calendar by themselves, and change when you change them in the hub:
        job start dates, site visits, quote follow-ups (3 days after a quote is sent) and invoice due dates.
      </p>
      {error && <p className="calc-note" style={{ color: "var(--bad)" }}>{error}</p>}
      {links && (
        <>
          <div className="calc-trigger-row">
            <a className="btn-primary" href={links.webcal} style={{ textDecoration: "none" }}><CalendarDays size={15} /> Subscribe on iPhone</a>
            <button type="button" className="btn-ghost" onClick={copy}>{copied ? "Copied!" : "Copy link"}</button>
          </div>
          <Field label="Calendar link (private — don't share it)">
            <input readOnly value={links.url} onFocus={(e) => e.target.select()} />
          </Field>
          <p className="calc-note">
            Easiest: open this screen on your iPhone and tap <strong>Subscribe on iPhone</strong>. Or copy the link, then on the iPhone go to
            Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar and paste it in.
          </p>
          <p className="calc-note">
            iPhone refreshes subscribed calendars on its own schedule, so new entries can take a while to appear
            (it isn't instant). Reminders: the day before at 3pm and the morning of for job starts; the day before and an hour before for timed site visits; 9am for follow-ups and invoices.
          </p>
        </>
      )}
      <GoogleSyncPanel />
    </Modal>
  );
}

function SettingsModal({ settings, onSave, onClose }) {
  const [form, setForm] = useState({ consumption: 10.5, fuelPrice: 1.85, tipRatePerMetre: 10, ...settings });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal title="Job cost defaults" onClose={onClose}>
      <p className="calc-note">Used to estimate fuel and tipping cost per job on quotes (employee pay is picked per quote — $40/hr cash or $50/hr ABN). Defaults are a rough starting point — adjust to what you're actually seeing.</p>
      <div className="field-pair">
        <Field label="Consumption (L/100km)"><input type="number" step="0.1" value={form.consumption ?? ""} onChange={(e) => set("consumption", e.target.value)} /></Field>
        <Field label="Diesel price ($/L)"><input type="number" step="0.01" value={form.fuelPrice ?? ""} onChange={(e) => set("fuelPrice", e.target.value)} /></Field>
      </div>
      <Field label="Tipping estimate ($/m of old timber fence removed)"><input type="number" step="1" value={form.tipRatePerMetre ?? ""} onChange={(e) => set("tipRatePerMetre", e.target.value)} /></Field>
      <div className="modal-actions">
        <button className="btn-primary" onClick={() => onSave(form)}><Check size={15} /> Save</button>
      </div>
    </Modal>
  );
}

// ---------- branded quote/invoice document ----------
function DocumentPreviewModal({ type, data, onClose }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const html = useMemo(() => buildDocumentHtml(type, data), [type, data]);

  const downloadPdf = async () => {
    setDownloading(true);
    setError("");
    try {
      const res = await fetch("/api/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, data }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `PDF generation failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${buildFilename(type, data)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(e.message || "PDF download failed — try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="doc-modal" onClick={(e) => e.stopPropagation()}>
        <style dangerouslySetInnerHTML={{ __html: DOC_CSS }} />
        <div className="doc-toolbar">
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
          <button className="btn-primary" onClick={downloadPdf} disabled={downloading}>
            <Download size={15} /> {downloading ? "Generating…" : "Download PDF"}
          </button>
        </div>
        {error ? (
          <p className="doc-toolbar-hint" style={{ color: "#C1553A" }}>{error}</p>
        ) : (
          <p className="doc-toolbar-hint">One tap — generates a proper PDF, ready to text or email to the client.</p>
        )}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

// ---------- Visit planner ----------
// Works out the best order and times for your quote visits (see lib/visitPlanner.js for the rules).
const GEO_KEY = "lyons:geo";
const PLAN_KEY = "lyons:visit-plan";
const readLS = (k, fallback) => {
  try {
    const raw = window.localStorage.getItem(k);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const writeLS = (k, v) => {
  try {
    window.localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};
const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));
const r5 = (m) => Math.round(m / 5) * 5; // times shown and saved to the nearest 5 minutes
const clock5 = (m) => fmtClock(r5(m));
const mapsTo = (address) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
const dayTitle = (date) => new Date(`${date}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
const dayTitleLong = (date) => new Date(`${date}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });

const DEFAULT_SMS = "Hi {name}, it's Artie from Lyons Fencing. I'm on my way to you now and should be there around {eta}. See you soon!";
// "Greg " -> "Greg"; skip placeholders like "N/A" so the text just says "Hi,".
const firstName = (name) => {
  const n = String(name || "").replace(/\(.*?\)/g, "").trim().split(/\s+/)[0] || "";
  return /^(n\/?a|lead|client)$/i.test(n) ? "" : n;
};
// iPhone wants "&body=" after the number, others "?body=".
const smsHref = (phone, body) => {
  const sep = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "&" : "?";
  return `sms:${String(phone).replace(/[^\d+]/g, "")}${sep}body=${encodeURIComponent(body)}`;
};
const nextSaturdayIso = (date) => {
  let d = date;
  for (let i = 0; i < 8; i++) {
    d = addDaysIso(d, 1);
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === 6) return d;
  }
  return d;
};
const nowMinutes = () => {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
};

// Paste what a client texted you: the hub keeps it in the lead's notes and picks out when they're available.
function TextImportModal({ lead, onApply, onClose }) {
  const [text, setText] = useState("");
  const avail = parseAvailability(text);
  const day = parseDay(text, today());
  const hasAvail = avail.notBefore != null || avail.notAfter != null;
  const addr = extractAddress(text);
  const addrChanges = !!addr && String(lead.address || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "") !== addr.full.toLowerCase().replace(/[^a-z0-9]/g, "");
  const [useAvail, setUseAvail] = useState(true);
  const [useDay, setUseDay] = useState(true);
  const [useAddr, setUseAddr] = useState(true);
  const [keep, setKeep] = useState(false); // also keep the message itself in the notes (off by default: only the useful part is saved)
  const when = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  const nothingPicked = !hasAvail && !day && !addrChanges;

  const apply = () => {
    const clean = text.trim().replace(/\s*\n\s*/g, " ").slice(0, 600);
    let notes = [String(lead.notes || "").trim(), keep && clean ? `Text ${when}: ${clean}` : ""].filter(Boolean).join("\n");
    if (useAvail && hasAvail) {
      const cur = parseNotesAvailability(lead.notes);
      notes = withAvailability(notes, { notBefore: avail.notBefore ?? cur.notBefore, notAfter: avail.notAfter ?? cur.notAfter });
    }
    const patch = { notes };
    if (useDay && day) patch.visitDate = day;
    if (useAddr && addrChanges) patch.address = addr.full;
    onApply(patch);
  };

  return (
    <Modal title={`Add a text${lead.name ? ` from ${firstName(lead.name) || lead.name}` : ""}`} onClose={onClose}>
      <p className="calc-note">Copy the client's text on your phone and paste it here. I pick out what's useful — an address, when they're free, a day — and you choose what to apply. The message itself isn't saved unless you tick that.</p>
      <Field label="Their text">
        <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Friday after 3:30 works for me, I'm at 12 Smith St" autoFocus />
      </Field>
      {text.trim() && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-head"><Check size={14} /><span>What I picked out</span></div>
          {nothingPicked && <p className="calc-note" style={{ margin: 0 }}>Nothing useful picked out (no address, time or day). Tick "keep the message" below if you want it in the notes.</p>}
          {addrChanges && (
            <label className="check-row">
              <input type="checkbox" checked={useAddr} onChange={(e) => setUseAddr(e.target.checked)} />
              <span>Set the address to {addr.full}</span>
            </label>
          )}
          {hasAvail && (
            <label className="check-row">
              <input type="checkbox" checked={useAvail} onChange={(e) => setUseAvail(e.target.checked)} />
              <span>
                {avail.notBefore != null ? `Free from ${fmtClock(avail.notBefore)} onwards` : ""}
                {avail.notBefore != null && avail.notAfter != null ? ", " : ""}
                {avail.notAfter != null ? `needs to be done before ${fmtClock(avail.notAfter)}` : ""} — the planner will respect this
              </span>
            </label>
          )}
          {day && (
            <label className="check-row">
              <input type="checkbox" checked={useDay} onChange={(e) => setUseDay(e.target.checked)} />
              <span>Set the visit day to {dayTitleLong(day)}</span>
            </label>
          )}
          <label className="check-row">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            <span>Also keep the message itself in their notes</span>
          </label>
        </div>
      )}
      <div className="modal-actions">
        <button className="btn-primary" disabled={!text.trim() || (nothingPicked && !keep)} onClick={apply}><Check size={15} /> Save to {firstName(lead.name) || "the lead"}</button>
      </div>
    </Modal>
  );
}

function VisitPlanner({ leads, quotes, setLeads, setQuotes, go }) {
  const t = today();
  const { confirmed, flexible, left } = useMemo(() => collectVisits(leads, quotes, t), [leads, quotes, t]);
  const allStops = useMemo(() => [...confirmed, ...flexible], [confirmed, flexible]);
  // Days you're on a job: the plan starts from the job site when work finishes. Home and the job sites also need finding on the map.
  const jobs = useMemo(() => collectJobDays(quotes, t), [quotes, t]);
  const locStops = useMemo(() => [...allStops, { id: HOME.id, query: HOME.query }, ...jobs.map((j) => ({ id: j.id, query: j.query }))], [allStops, jobs]);

  // What you've chosen (kept on this device): which view, per-day start settings, locked times, visit lengths.
  const [saved, setSaved] = useState(() => ({ mode: "best", overrides: {}, locks: {}, durations: {}, moves: {}, midday: {}, orders: {}, dismissed: {}, workStart: WORK_START, smsTemplate: DEFAULT_SMS, ...readLS(PLAN_KEY, {}) }));
  useEffect(() => writeLS(PLAN_KEY, saved), [saved]);
  const patchSaved = (patch) => setSaved((s) => ({ ...s, ...patch }));

  // ----- 1) find each address on the map (one a second, remembered after the first time) -----
  const [coords, setCoords] = useState(() => readLS(GEO_KEY, {})); // address text -> { lat, lon } | false (not found)
  const [geo, setGeo] = useState({ running: false, done: 0, total: 0 });
  const [retry, setRetry] = useState(0);
  const queryKey = locStops.map((s) => s.query).join("|");
  useEffect(() => {
    const todo = [...new Set(locStops.map((s) => s.query))].filter((q) => coords[q] === undefined);
    if (todo.length === 0) return undefined;
    let cancelled = false;
    (async () => {
      setGeo({ running: true, done: 0, total: todo.length });
      const found = {};
      for (let i = 0; i < todo.length && !cancelled; i++) {
        try {
          const r = await fetch("/api/plan/locate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: todo[i] }) });
          const b = await r.json().catch(() => ({}));
          if (r.ok) found[todo[i]] = { lat: b.lat, lon: b.lon };
          else if (r.status === 404) found[todo[i]] = false; // genuinely not on the map; a temporary error is simply retried next time
        } catch {
          // network blip: try again next time
        }
        setGeo({ running: true, done: i + 1, total: todo.length });
        if (i < todo.length - 1) await waitMs(1100);
      }
      if (cancelled) return;
      setCoords((c) => {
        const merged = { ...c, ...found };
        writeLS(GEO_KEY, merged);
        return merged;
      });
      setGeo({ running: false, done: 0, total: 0 });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, retry]);

  // ----- 2) real driving times between everything -----
  const { nodes, index } = useMemo(() => buildNodes(locStops, coords), [locStops, coords]);
  const nodeKey = nodes.map((n) => `${n.lat.toFixed(4)},${n.lon.toFixed(4)}`).join(";");
  const [matrix, setMatrix] = useState(null); // { key, minutesRaw, source }
  const [matrixError, setMatrixError] = useState("");
  useEffect(() => {
    if (nodes.length <= 3) { setMatrix(null); return undefined; }
    if (matrix?.key === nodeKey) return undefined;
    let off = false;
    setMatrixError("");
    fetch("/api/plan/drive-times", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: nodes }) })
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok || !b.minutes) throw new Error(b.error || "no driving times");
        if (!off) setMatrix({ key: nodeKey, minutesRaw: b.minutes, source: b.source });
      })
      .catch((e) => { if (!off) setMatrixError(e.message); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey]);

  // ----- 3) the plan -----
  const planned = useMemo(() => {
    if (!matrix || matrix.key !== nodeKey) return null;
    return runPlan({ confirmed, flexible, coords, minutesRaw: matrix.minutesRaw, index, overrides: saved.overrides, locks: saved.locks, durations: saved.durations, moves: saved.moves, midday: saved.midday, orders: saved.orders, jobs, workStart: saved.workStart, today: t });
  }, [matrix, nodeKey, confirmed, flexible, coords, index, jobs, t, saved.overrides, saved.locks, saved.durations, saved.moves, saved.midday, saved.orders, saved.workStart]);

  // Common-sense suggestions: a day that's too full, and which visit to move to which day. (Dismissed ones stay hidden.)
  const sugKey = (x) => `${x.stopId}:${x.from}:${x.to}`;
  const suggestions = (planned?.suggestions || []).filter((x) => !saved.dismissed?.[sugKey(x)] && allStops.some((s) => s.id === x.stopId));
  const planDates = planned ? Object.keys(planned.days).filter((d) => planned.days[d].stops.length + planned.days[d].midday.length > 0).sort() : [];
  const [selected, setSelected] = useState(null);
  const date = planDates.includes(selected) ? selected : planDates[0] || null;
  const [note, setNote] = useState("");

  const missing = allStops.filter((s) => coords[s.query] === false);
  const lookingUp = geo.running || (allStops.length > 0 && allStops.some((s) => coords[s.query] === undefined));

  // The plan for the day being looked at, in whichever view is chosen.
  const dayView = (d) => {
    const keep = saved.mode === "keep" && d.asBooked && !d.asBooked.infeasible;
    return keep ? d.asBooked : d.plan;
  };

  const settingsFor = (d) => ({ ...d.settings });
  const setDaySetting = (patch) => patchSaved({ overrides: { ...saved.overrides, [date]: { ...(saved.overrides[date] || {}), ...patch } } });

  const apply = (dates) => {
    const changes = {};
    for (const dt of dates) {
      const d = planned.days[dt];
      for (const e of [...d.midday, ...dayView(d).entries]) {
        const s = e.stop || d.stops.find((x) => x.id === e.id);
        changes[s.leadId] = { visitDate: dt, visitTime: fmtHHMM(r5(e.start)) };
      }
    }
    const n = Object.keys(changes).length;
    setLeads((rows) => rows.map((l) => (changes[l.id] ? { ...l, ...changes[l.id] } : l)));
    // A visit you moved to another day now carries that day on its lead, so the "moved" note isn't needed any more.
    const remaining = { ...saved.moves };
    for (const dt of dates) for (const s of [...planned.days[dt].stops, ...planned.days[dt].midday.map((m) => m.stop)]) if (remaining[s.id] === dt) delete remaining[s.id];
    patchSaved({ moves: remaining });
    setNote(`Saved ${n} visit${n === 1 ? "" : "s"} — the dates and times are on those leads now, and in your calendar.`);
  };

  // ----- things you can change on a visit -----
  const [editLead, setEditLead] = useState(null); // the lead being edited from the planner
  const [askRemove, setAskRemove] = useState(null); // stop id waiting for "mark lost / delete / keep"
  const todayLabel = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  // Cancelling: "lost" keeps the lead (greyed out, with a note) and takes it out of the plan; "delete" removes it completely.
  const removeVisit = (s, how) => {
    if (how === "delete") {
      setLeads((rows) => rows.filter((l) => l.id !== s.leadId));
      setNote(`Deleted ${s.name} from your leads — they're out of the plan.`);
    } else {
      setLeads((rows) => rows.map((l) => (l.id === s.leadId ? { ...l, status: "Lost", notes: [String(l.notes || "").trim(), `Cancelled: no longer wants a quote (${todayLabel}).`].filter(Boolean).join("\n") } : l)));
      setNote(`${s.name} is marked Lost and out of the plan. You can bring them back from the Leads tab.`);
    }
    setAskRemove(null);
  };
  // "Checked: ..." after a flagged text means you've looked at it and they're still on.
  // ----- clients who texted asking to move things -----
  const addLine = (notes, line) => [String(notes || "").trim(), line].filter(Boolean).join("\n");
  const sameClient = (q, l) => {
    const tail9 = (p) => String(p || "").replace(/\D/g, "").slice(-9);
    const nm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return (tail9(q.clientPhone).length >= 8 && tail9(q.clientPhone) === tail9(l.phone)) || (nm(q.clientName) && nm(q.clientName) === nm(l.name));
  };
  const rescheduleReqs = leads
    .filter((l) => l.status !== "Lost")
    .map((l) => {
      const hint = rescheduleHint(l.notes, t);
      if (!hint) return null;
      const visit = ["New", "Contacted"].includes(l.status);
      const job = visit ? null : quotes.find((q) => q.status === "Accepted" && isIsoDate(q.startDate) && q.startDate >= t && sameClient(q, l));
      if (!visit && !job) return null;
      // "push it back" can't mean an earlier day than the one they have now, so don't guess in that case.
      const current = job?.startDate || l.visitDate || "";
      const pushing = /\b(push|postpone|delay|later|back)\b/i.test(hint.text);
      const day = hint.day && current && hint.day < current && pushing ? null : hint.day;
      return { lead: l, hint: { ...hint, day }, job, kind: visit ? "visit" : "job" };
    })
    .filter(Boolean);
  // "Checked: …" after a flagged text means it's been dealt with, so it stops showing.
  const dismissReschedule = (r) => {
    setLeads((rows) => rows.map((l) => (l.id === r.lead.id ? { ...l, notes: addLine(l.notes, `Checked: no change needed (${todayLabel}).`) } : l)));
    setNote(`Okay — ${r.lead.name} stays as they are.`);
  };
  const applyReschedule = (r, date, withText) => {
    const stamp = `Checked: moved to ${dayTitle(date)} (${todayLabel}).`;
    if (r.kind === "visit") {
      rememberMove({ leadId: r.lead.id, name: r.lead.name }, `Moved ${r.lead.name}'s visit to ${dayTitle(date)}.`);
      setLeads((rows) => rows.map((l) => (l.id === r.lead.id ? { ...l, visitDate: date, visitTime: "", notes: addLine(l.notes, stamp) } : l)));
      setSelected(date);
    } else {
      setQuotes((rows) => rows.map((q) => (q.id === r.job.id ? { ...q, startDate: date } : q)));
      setLeads((rows) => rows.map((l) => (l.id === r.lead.id ? { ...l, notes: addLine(l.notes, stamp) } : l)));
    }
    if (r.kind === "job") setNote(`Moved ${r.lead.name}'s job start to ${dayTitle(date)}.`);
    if (withText && r.lead.phone) {
      const first = firstName(r.lead.name) || "there";
      const body = `Hi ${first}, no problem — I've moved you to ${dayTitleLong(date)}. See you then. Cheers, Artie`;
      setTimeout(() => { window.location.href = smsHref(r.lead.phone, body); }, 500);
    }
  };
  const keepVisit = (s) => {
    setLeads((rows) => rows.map((l) => (l.id === s.leadId ? { ...l, notes: [String(l.notes || "").trim(), `Checked: still wants a quote (${todayLabel}).`].filter(Boolean).join("\n") } : l)));
    setNote(`Okay — ${s.name} stays in the plan.`);
  };
  const cancelHints = allStops.map((s) => ({ s, text: cancellationHint(s.notes) })).filter((h) => h.text);
  const [textFor, setTextFor] = useState(null); // the stop whose text message is being pasted
  const [busyStop, setBusyStop] = useState(null);
  const [showSms, setShowSms] = useState(false);
  const setAvailability = (s, patch) => {
    const cur = { notBefore: s.notBefore ?? null, notAfter: s.notAfter ?? null, ...patch };
    setLeads((rows) => rows.map((l) => (l.id === s.leadId ? { ...l, notes: withAvailability(l.notes, cur) } : l)));
  };
  const moveStop = (s, date) => {
    const next = { ...saved.moves };
    if (date) next[s.id] = date;
    else delete next[s.id];
    patchSaved({ moves: next });
    if (date) setSelected(date);
  };

  // ----- moving a visit (something came up): the new date goes straight onto the lead, with an Undo -----
  const [moveFor, setMoveFor] = useState(null); // the visit whose Move screen is open
  const [lastMove, setLastMove] = useState(null); // { leadId, name, prev: { visitDate, visitTime } } for Undo
  useEffect(() => {
    if (!lastMove) return undefined;
    const timer = setTimeout(() => setLastMove(null), 15000);
    return () => clearTimeout(timer);
  }, [lastMove]);
  const leadOf = (s) => leads.find((l) => l.id === s.leadId);
  const rememberMove = (s, message) => {
    const l = leadOf(s);
    setLastMove({ leadId: s.leadId, name: s.name, prev: { visitDate: l?.visitDate || "", visitTime: l?.visitTime || "", notes: l?.notes ?? "" } });
    setNote(message);
  };
  const moveNow = (s, date, withText) => {
    if (!s.leadId || !date) return;
    rememberMove(s, `Moved ${s.name} to ${dayTitle(date)}. It's saved on their lead and your calendar.`);
    // any older tentative move of this visit is replaced by the real date
    const rest = { ...saved.moves };
    delete rest[s.id];
    patchSaved({ moves: rest });
    setLeads((rows) => rows.map((l) => (l.id === s.leadId ? { ...l, visitDate: date, visitTime: "", notes: rescheduleHint(l.notes, t) ? addLine(l.notes, `Checked: moved to ${dayTitle(date)} (${todayLabel}).`) : l.notes } : l)));
    setSelected(date);
    setMoveFor(null);
    if (withText && s.phone) {
      const first = firstName(s.name) || "there";
      const body = `Hi ${first}, it's Artie from Lyons Fencing. No problem — would ${dayTitleLong(date)}${s.notBefore != null ? ` after ${fmtClock(s.notBefore)}` : ""} suit for me to come out and look at the job instead? Let me know. Cheers`;
      setTimeout(() => { window.location.href = smsHref(s.phone, body); }, 500); // gives the save a moment to start first
    }
  };
  const setStopTime = (s, hhmm) => {
    rememberMove(s, hhmm ? `Set ${s.name}'s time to ${fmtClock(parseTime(hhmm))}.` : `Cleared ${s.name}'s time.`);
    setLeads((rows) => rows.map((l) => (l.id === s.leadId ? { ...l, visitTime: hhmm || "" } : l)));
    setMoveFor(null);
  };
  const autoPlace = (s) => {
    rememberMove(s, `${s.name} no longer has a day, so the planner has placed them on the best one (marked "placed here"). Tap "Save this day's times" there to fix it.`);
    setLeads((rows) => rows.map((l) => (l.id === s.leadId ? { ...l, visitDate: "", visitTime: "" } : l)));
    setMoveFor(null);
  };
  // Dragging a visit: up/down within the day changes the order (times re-work themselves); onto a day chip moves it to that day.
  const { drag, listRef, gripProps } = useVisitDrag({
    onReorder: (date, ids) => {
      patchSaved({ orders: { ...saved.orders, [date]: ids } });
      setNote("Order changed — the times have been re-worked. Tap “Save this day's times” to keep them.");
    },
    onDropOnDay: (id, date) => {
      const st = allStops.find((x) => x.id === id);
      if (st) moveNow(st, date, false);
    },
  });
  const resetOrder = (date) => {
    const rest = { ...saved.orders };
    delete rest[date];
    patchSaved({ orders: rest });
  };
  const undoMove = () => {
    if (!lastMove) return;
    setLeads((rows) => rows.map((l) => (l.id === lastMove.leadId ? { ...l, ...lastMove.prev } : l)));
    setNote(`Put ${lastMove.name} back where they were.`);
    setLastMove(null);
  };

  // "On my way": works out when you'll really get there from where you are now, then opens a text to the client
  // ready to send (it goes from your own number, so replies land in your Messages).
  const onMyWay = async (s, entry) => {
    setBusyStop(s.id);
    let etaMin = Math.max(entry.start, nowMinutes());
    let how = "the planned time (your location wasn't available)";
    try {
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) reject(new Error("no location"));
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
      });
      const dest = coords[s.query];
      if (dest) {
        const r = await fetch("/api/plan/drive-times", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points: [{ lat: pos.coords.latitude, lon: pos.coords.longitude }, dest] }),
        });
        const b = await r.json();
        const drive = b.minutes?.[0]?.[1];
        if (Number.isFinite(drive)) {
          etaMin = nowMinutes() + Math.ceil(drive * TRAFFIC_FACTOR);
          how = `${Math.ceil(drive * TRAFFIC_FACTOR)} min from where you are now`;
        }
      }
    } catch {
      // no location permission or no signal: the planned time is used
    }
    const eta = fmtClock(Math.ceil(etaMin / 5) * 5);
    const body = String(saved.smsTemplate || DEFAULT_SMS).replace("{name}", firstName(s.name) || "there").replace("{eta}", eta).replace("Hi there,", "Hi,");
    setBusyStop(null);
    setNote(`Opening a text to ${firstName(s.name) || s.name} saying around ${eta} — worked out from ${how}.`);
    window.location.href = smsHref(s.phone, body);
  };

  // Where the day's driving starts from, in words.
  const startName = (d) => (d.settings.start === "job" && d.job ? `${d.job.name}'s job` : (PLACES[d.settings.start]?.name || "start").split(" (")[0]);
  const copyDay = async (d) => {
    const v = dayView(d);
    const lines = [dayTitleLong(d.date)];
    for (const m of d.midday) lines.push(`${clock5(m.start)}  ${m.stop.name} — ${m.stop.address}${m.stop.phone ? ` (${m.stop.phone})` : ""}  [mid-day, out of ${d.job.name}]`);
    lines.push(`Leave ${startName(d)}${v.leave != null ? ` ${clock5(v.leave)}` : ""}`);
    for (const e of v.entries) {
      const s = d.stops.find((x) => x.id === e.id);
      lines.push(`${clock5(e.start)}  ${s.name} — ${s.address}${s.phone ? ` (${s.phone})` : ""}  [${Math.round(e.driveMin)} min drive]`);
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setNote("Copied — paste it into a text or note.");
    } catch {
      setNote("Couldn't copy automatically.");
    }
  };

  const routeLink = (d) => {
    const v = dayView(d);
    const addrs = v.entries.map((e) => d.stops.find((x) => x.id === e.id).query);
    if (addrs.length === 0) return null;
    const origin = encodeURIComponent(d.settings.start === "job" && d.job ? d.job.query : `${PLACES[d.settings.start]?.name.split(" (")[0] || "Cleveland"} QLD`);
    const dest = encodeURIComponent(HOME.query);
    const way = addrs.map(encodeURIComponent).join("%7C");
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}${way ? `&waypoints=${way}` : ""}&travelmode=driving`;
  };

  const d = planned && date ? planned.days[date] : null;
  const view = d ? dayView(d) : null;
  const best = d?.plan;
  const keep = d?.asBooked;

  // The buttons under each visit (e = its entry in the plan: start time, length, the time the client was given).
  const stopTools = (s, e, dd) => {
    const onJob = dd.settings.start === "job" && !!dd.job;
    return (
      <div className="vp-actions">
        <a className="btn-ghost small" href={mapsTo(s.address ? `${s.address}` : s.query)} target="_blank" rel="noreferrer"><Navigation size={13} /> Directions</a>
        {s.phone && <a className="btn-ghost small" href={`tel:${s.phone}`}><Phone size={13} /> Call</a>}
        {s.phone ? (
          <button className="btn-primary small" onClick={() => onMyWay(s, e)} disabled={busyStop === s.id} title="Works out your real ETA from where you are and opens a text to the client, ready to send">
            <Send size={13} /> {busyStop === s.id ? "Working out your ETA…" : "On my way"}
          </button>
        ) : (
          <span className="calc-note" style={{ margin: 0 }}>No phone number on this lead</span>
        )}
        {e.preferred != null && !e.midday && (
          <button className={`btn-ghost small${saved.locks[s.id] ? " on" : ""}`} onClick={() => patchSaved({ locks: { ...saved.locks, [s.id]: !saved.locks[s.id] } })} title="Keep this client's time exactly and plan around it">
            {saved.locks[s.id] ? <Lock size={13} /> : <Unlock size={13} />} {saved.locks[s.id] ? "Time kept" : "Keep time"}
          </button>
        )}
        <label className="vp-nb" title={e.midday ? "The time you'll see them (saved in their notes)" : "This client can't be seen before this time (saved in their notes)"}>
          {e.midday ? "Time" : "Not before"}
          <input type="time" value={e.midday ? fmtHHMM(e.start) : s.notBefore != null ? fmtHHMM(s.notBefore) : ""} onChange={(ev) => setAvailability(s, { notBefore: parseTime(ev.target.value) })} />
        </label>
        <select className="vp-dur" value={e.durationMin} onChange={(ev) => patchSaved({ durations: { ...saved.durations, [s.id]: Number(ev.target.value) } })} aria-label="Visit length">
          {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
        </select>
        {onJob && (
          e.midday ? (
            <button className="btn-ghost small" onClick={() => patchSaved({ midday: { ...saved.midday, [s.id]: false } })} title="Do this one on the way home instead">After work instead</button>
          ) : (
            <button className="btn-ghost small" onClick={() => patchSaved({ midday: { ...saved.midday, [s.id]: true } })} title="Pop out of the job for this one (the client wants mid-day)">Do mid-day</button>
          )
        )}
        <button className="btn-ghost small" onClick={() => setTextFor(s)}><ClipboardPaste size={13} /> Paste a text</button>
        <button className="btn-ghost small" onClick={() => go("quotes", { newFromLead: leads.find((l) => l.id === s.leadId) || { id: s.leadId, name: s.name, phone: s.phone, address: s.address, jobType: s.jobType } })} title="Start a quote with their details filled in"><FileText size={13} /> Start quote</button>
        <button className="btn-ghost small" onClick={() => setEditLead(leads.find((l) => l.id === s.leadId) || null)}>Edit lead</button>
        {askRemove === s.id ? (
          <span className="vp-confirm">
            Take {firstName(s.name) || "them"} out?
            <button className="btn-primary small" onClick={() => removeVisit(s, "lost")} title="Keeps the lead, marked Lost">Mark lost</button>
            <button className="btn-danger small" onClick={() => removeVisit(s, "delete")} title="Removes the lead completely">Delete</button>
            <button className="btn-ghost small" onClick={() => setAskRemove(null)}>Keep</button>
          </span>
        ) : (
          <button className="btn-ghost small" onClick={() => setAskRemove(s.id)}><X size={13} /> Cancelled</button>
        )}
        {s.leadId && <button className="btn-primary small" onClick={() => setMoveFor({ stop: s, fromDate: dd.date })} title="Move this visit to another day, or set a time"><Route size={13} /> Move…</button>}
        {!dd.saturday && dd.stops.length + dd.midday.length > 1 && (
          <button className="btn-ghost small" onClick={() => moveNow(s, nextSaturdayIso(dd.date), false)}>
            Move to Saturday{dd.moveSavings?.[s.id]?.driveMin >= 3 ? ` (saves ${Math.round(dd.moveSavings[s.id].driveMin)} min driving${dd.moveSavings[s.id].finishMin >= 10 ? `, home ${Math.round(dd.moveSavings[s.id].finishMin)} min earlier` : ""})` : ""}
          </button>
        )}
        {s.movedByYou && <button className="btn-ghost small" onClick={() => moveStop(s, null)}>Back to {dayTitle(s.movedFrom)}</button>}
      </div>
    );
  };

  return (
    <div>
      <div className="section-head">
        <h1>Visit planner</h1>
        <p>Works out the best order and times for your quote visits, north to south, with real driving times. Leads with a ? after the name are left out until they confirm.</p>
      </div>

      {allStops.length === 0 && (
        <EmptyState icon={Route} title="No visits to plan" hint="Give a lead an address and a site visit date (Leads tab) and it shows up here. A lead with an address but no date gets placed on the best day." />
      )}

      {lookingUp && (
        <div className="fuel-note"><MapPin size={14} /> Finding addresses on the map… {geo.total > 0 ? `${geo.done} of ${geo.total}` : ""} (only needed the first time)</div>
      )}
      {matrixError && <p className="calc-note" style={{ color: "var(--bad)" }}>Couldn't get driving times ({matrixError}). Try again in a minute.</p>}
      {matrix?.source === "estimate" && (
        <p className="calc-note">The routing service is busy, so these drive times are straight-line estimates, not real roads. Treat them as rough.</p>
      )}
      {note && (
        <p className="calc-note" style={{ color: "var(--good)" }}>
          {note} {lastMove && <button className="link-btn" onClick={undoMove}><Undo2 size={12} style={{ verticalAlign: "-2px" }} /> Undo</button>}
        </p>
      )}
      {drag && (
        <div className="vp-dragbar" role="presentation">
          <span>Drop on a day to move there:</span>
          <div className="vp-dragbar-days">
            {Array.from({ length: 10 }, (_, i) => addDaysIso(t, i))
              .filter((dt) => dt !== drag.date && new Date(`${dt}T00:00:00Z`).getUTCDay() !== 0)
              .map((dt) => (
                <button key={dt} type="button" data-drop-day={dt} className={drag.overDay === dt ? "on" : ""}>{dayTitle(dt)}</button>
              ))}
          </div>
        </div>
      )}
      {moveFor && (
        <MoveSheet
          stop={moveFor.stop}
          lead={leadOf(moveFor.stop)}
          fromDate={moveFor.fromDate}
          today={t}
          fitFor={planned?.fitFor || (() => null)}
          onMove={(date, withText) => moveNow(moveFor.stop, date, withText)}
          onTime={(hhmm) => setStopTime(moveFor.stop, hhmm)}
          onAuto={() => autoPlace(moveFor.stop)}
          onClose={() => setMoveFor(null)}
        />
      )}

      {rescheduleReqs.length > 0 && (
        <div className="panel vp-resched">
          <div className="panel-head"><CalendarDays size={16} /><span>Asked to reschedule</span></div>
          {rescheduleReqs.map((r) => {
            const first = firstName(r.lead.name) || r.lead.name;
            const what = r.kind === "job" ? "job start" : "visit";
            const stop = r.kind === "visit" ? allStops.find((s) => s.leadId === r.lead.id) : null;
            return (
              <div key={r.lead.id} className="vp-cancel-row">
                <div>
                  <strong>{r.lead.name}</strong> texted: “{r.hint.text.length > 140 ? `${r.hint.text.slice(0, 140)}…` : r.hint.text}”
                  <div className="calc-note" style={{ margin: "2px 0 0" }}>
                    {r.kind === "job" ? `Their job is booked to start ${dayTitle(r.job.startDate)}.` : r.lead.visitDate ? `Their visit is on ${dayTitle(r.lead.visitDate)}.` : "They don't have a visit day yet."}
                    {r.hint.day ? ` They seem to mean ${dayTitleLong(r.hint.day)}.` : " They didn't say which day."}
                  </div>
                </div>
                <div className="vp-actions">
                  {r.hint.day && <button className="btn-primary small" onClick={() => applyReschedule(r, r.hint.day, false)}>Move {what} to {dayTitle(r.hint.day)}</button>}
                  {r.hint.day && r.lead.phone && <button className="btn-ghost small" onClick={() => applyReschedule(r, r.hint.day, true)}><Send size={13} /> Move &amp; text them</button>}
                  {stop ? (
                    <button className="btn-ghost small" onClick={() => setMoveFor({ stop, fromDate: r.lead.visitDate || t })}>Choose another day…</button>
                  ) : (
                    <label className="vp-nb">Another day <input type="date" min={t} onChange={(ev) => ev.target.value && applyReschedule(r, ev.target.value, false)} /></label>
                  )}
                  <button className="btn-ghost small" onClick={() => dismissReschedule(r)}>Leave as is</button>
                </div>
              </div>
            );
          })}
          <p className="calc-note" style={{ marginBottom: 0 }}>Nothing moves until you tap — I only read the day they mention. "Move &amp; text them" opens a message confirming the new day for you to send.</p>
        </div>
      )}

      {cancelHints.length > 0 && (
        <div className="panel vp-cancel">
          <div className="panel-head"><AlertTriangle size={16} /><span>May have cancelled</span></div>
          {cancelHints.map(({ s, text }) => (
            <div key={s.id} className="vp-cancel-row">
              <div><strong>{s.name}</strong> texted: “{text.length > 140 ? `${text.slice(0, 140)}…` : text}”</div>
              <div className="vp-actions">
                <button className="btn-primary small" onClick={() => removeVisit(s, "lost")}>Yes — take them out</button>
                <button className="btn-ghost small" onClick={() => keepVisit(s)}>No, still on</button>
              </div>
            </div>
          ))}
          <p className="calc-note" style={{ marginBottom: 0 }}>I only flag it — nobody is removed until you say so.</p>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="panel vp-suggest">
          <div className="panel-head"><Route size={16} /><span>Suggestions</span></div>
          {suggestions.map((x) => {
            const stop = allStops.find((s) => s.id === x.stopId);
            const first = firstName(x.name) || x.name;
            const n = planned.days[x.from]?.stops.length || 0;
            const why = x.bookedTime != null
              ? `${x.name} was booked for ${fmtClock(x.bookedTime)}, but the times booked on ${dayTitle(x.from)} can't all be met — the drives between them are too far apart. This one eases it most.`
              : x.notBefore != null
                ? `${x.name} can't start before ${fmtClock(x.notBefore)}, and ${dayTitle(x.from)} is already packed (${n} visits), so they'd be squeezed in at the end of a long day.`
                : `${dayTitle(x.from)} is packed (${n} visits) and ${x.name} has no time booked, so they're the easiest to move.`;
            const body = `Hi ${first}, it's Artie from Lyons Fencing. Would ${dayTitleLong(x.to)}${x.notBefore != null ? ` after ${fmtClock(x.notBefore)}` : ""} suit for me to come out and look at the job instead? Cheers`;
            return (
              <div key={sugKey(x)} className="vp-sug">
                <div className="vp-sug-main">
                  <strong>Move {first} to {dayTitle(x.to)}</strong>
                  <div className="calc-note" style={{ margin: "2px 0 0" }}>{why} {dayTitle(x.to)} has room{x.addsDriveMin > 0 ? `, adding about ${x.addsDriveMin} min of driving` : ""}.</div>
                </div>
                <div className="vp-actions">
                  <button className="btn-primary small" onClick={() => moveNow(stop, x.to, false)}>Move to {dayTitle(x.to)}</button>
                  {stop?.phone && <a className="btn-ghost small" href={smsHref(stop.phone, body)}><Send size={13} /> Text {first}</a>}
                  <button className="btn-ghost small" onClick={() => patchSaved({ dismissed: { ...saved.dismissed, [sugKey(x)]: true } })}>Not now</button>
                </div>
              </div>
            );
          })}
          <p className="calc-note" style={{ marginBottom: 0 }}>Only a suggestion — nothing changes until you tap Move, and the client isn't told unless you send the text.</p>
        </div>
      )}

      {(left.length > 0 || missing.length > 0 || (planned?.notes || []).length > 0) && (
        <div className="panel">
          <div className="panel-head"><AlertTriangle size={16} /><span>Left out of the plan</span></div>
          {left.map((l, i) => (
            <div key={i} className="vp-left"><strong>{l.name}</strong> — {l.why}{l.date ? ` (${dayTitle(l.date)})` : ""}</div>
          ))}
          {missing.map((s) => (
            <div key={s.id} className="vp-left"><strong>{s.name}</strong> — couldn't find "{s.address}" on the map. Check the address on the lead.{" "}
              <button className="link-btn" onClick={() => { setCoords((c) => { const n = { ...c }; delete n[s.query]; writeLS(GEO_KEY, n); return n; }); setRetry((r) => r + 1); }}>Try again</button>
            </div>
          ))}
          {(planned?.notes || []).map((n, i) => <div key={i} className="vp-left">{n.text}</div>)}
        </div>
      )}

      {planDates.length > 0 && (
        <>
          <div className="vp-modebar">
            <div className="vp-seg">
              <button className={saved.mode === "best" ? "on" : ""} onClick={() => patchSaved({ mode: "best" })}>Best route</button>
              <button className={saved.mode === "keep" ? "on" : ""} onClick={() => patchSaved({ mode: "keep" })}>Keep my booked times</button>
            </div>
            <span className="calc-note" style={{ margin: 0 }}>Best route may move some times; "keep" sticks to the times you gave clients.</span>
          </div>

          <div className="vp-days">
            {planDates.map((dt) => {
              const dd = planned.days[dt];
              return (
                <button key={dt} className={`vp-day${dt === date ? " on" : ""}${dd.plan.fits ? "" : " warn"}`} onClick={() => setSelected(dt)}>
                  <strong>{dayTitle(dt)}</strong>
                  <span>{dd.stops.length} visit{dd.stops.length === 1 ? "" : "s"}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {d && view && (
        <div className="panel">
          <div className="panel-head"><Route size={16} /><span>{dayTitleLong(d.date)}</span></div>

          <div className="vp-settings">
            <Field label="Starting from">
              <select value={d.settings.start} onChange={(e) => setDaySetting({ start: e.target.value })}>
                {d.job && <option value="job">{d.job.name}'s job site</option>}
                {Object.values(PLACES).map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            </Field>
            {d.settings.start === "job" ? (
              <>
                <Field label="You start work at">
                  <input type="time" value={fmtHHMM(saved.workStart)} onChange={(e) => patchSaved({ workStart: parseTime(e.target.value) ?? WORK_START })} />
                </Field>
                <Field label="Finish work at">
                  <input type="time" value={fmtHHMM(d.job.workEnd)} onChange={(e) => setDaySetting({ workEnd: parseTime(e.target.value) ?? undefined })} />
                </Field>
              </>
            ) : (
              <>
                <Field label={d.settings.flexDepart && d.settings.depart != null ? "Earliest you can leave" : "Leave at"}>
                  <input type="time" value={d.settings.depart != null ? fmtHHMM(d.settings.depart) : ""} onChange={(e) => setDaySetting({ depart: parseTime(e.target.value) })} />
                </Field>
                <Field label="First visit no earlier than">
                  <input type="time" value={d.settings.earliestStart ? fmtHHMM(d.settings.earliestStart) : ""} onChange={(e) => setDaySetting({ earliestStart: parseTime(e.target.value) ?? 0 })} />
                </Field>
              </>
            )}
          </div>
          {d.settings.start === "job" ? (
            <p className="calc-note">
              You're on <strong>{d.job.name}</strong> at {d.job.address} ({hoursLabel(d.job.hours)} of work), so the plan starts from the job when you finish and ends at home. It leaves as late as it usefully can.
              {d.job.awayMin > 0 ? ` Mid-day visits take you away for ${Math.round(d.job.awayMin)} min, so work finishes about ${clock5(d.job.finishWork)}.` : ""}
            </p>
          ) : (
            <label className="check-row">
              <input type="checkbox" checked={!!d.settings.flexDepart && d.settings.depart != null} disabled={d.settings.depart == null} onChange={(e) => setDaySetting({ flexDepart: e.target.checked })} />
              <span>Leave later if it helps — I'll pick the best time to leave (never earlier than the time above)</span>
            </label>
          )}
          {d.job && d.settings.start !== "job" && <p className="calc-note">You're also on {d.job.name}'s job this day — pick it under "Starting from" to plan from the job site.</p>}

          <div className="vp-summary">
            <div><span>Leave</span><strong>{view.leave != null ? clock5(view.leave) : "—"}</strong></div>
            <div><span>Last visit ends</span><strong>{view.finish != null ? clock5(view.finish) : d.midday.length ? clock5(d.midday[d.midday.length - 1].end) : "—"}</strong></div>
            <div><span>Driving</span><strong>{Math.round(view.driveMin + d.midday.reduce((n, m) => n + m.driveMin + m.driveBack, 0))} min</strong></div>
            <div><span>{planned.hasHome ? "Home" : "Back to Burleigh"}</span><strong>+{Math.round(view.endLegMin)} min</strong></div>
          </div>
          {!view.fits && (
            <div className="over-warning"><AlertTriangle size={14} /> Too tight: the last visit would start {Math.round(view.overBy)} min after 5:45pm. Move something to another day.</div>
          )}

          {keep && !keep.infeasible && best && saved.mode === "best" && (Math.round(keep.driveMin - best.driveMin) > 0 || keep.finish - best.finish > 10) && (
            <p className="calc-note vp-compare">
              Keeping every time you gave would mean <strong>{Math.round(keep.driveMin)} min</strong> driving (+{Math.max(0, Math.round(keep.driveMin - best.driveMin))}) and finishing at <strong>{clock5(keep.finish)}</strong>
              {keep.entries.some((e) => e.lateBy > 0) ? `, with ${keep.entries.filter((e) => e.lateBy > 0).map((e) => `${d.stops.find((s) => s.id === e.id).name} ${e.lateBy} min late`).join(", ")}` : ""}.
            </p>
          )}
          {keep?.infeasible && saved.mode === "best" && d.stops.some((s) => s.preferred != null) && (
            <p className="calc-note vp-compare">The times you've given clients can't all be met (the drives are too far apart), so something has to move.</p>
          )}
          {saved.mode === "keep" && (!keep || keep.infeasible) && <p className="calc-note">Your booked times can't all be met, so this shows the best route instead.</p>}

          {saved.orders?.[d.date] && (
            <p className="calc-note">
              {view.forcedBroken ? "That order would miss a locked time, so the best route is shown instead. " : "You set the order for this day. "}
              <button className="link-btn" onClick={() => resetOrder(d.date)}>Back to the best route</button>
            </p>
          )}
          {view.entries.length > 1 && <p className="calc-note" style={{ marginTop: 0 }}><GripVertical size={12} style={{ verticalAlign: "-2px" }} /> Hold the grip beside a visit and drag it up or down to change the order — or drop it on a day at the top to move it there.</p>}
          <div className="vp-stops" ref={listRef}>
            {d.midday.map((m) => (
              <div key={m.id}>
                <div className="vp-leg"><Car size={13} /> Out of {d.job.name}'s job at {clock5(m.leave)} · {Math.round(m.driveMin)} min drive</div>
                <div className="vp-stop vp-mid">
                  <div className="vp-time">
                    <strong>{clock5(m.start)}</strong>
                    <span>{clock5(m.end)}</span>
                  </div>
                  <div className="vp-body">
                    <div className="vp-name">{m.stop.name}{m.stop.jobType ? <span className="vp-type">{m.stop.jobType}</span> : null}<span className="vp-badge placed">mid-day</span>{m.stop.movedFrom ? <span className="vp-badge moved">moved from {dayTitle(m.stop.movedFrom)}</span> : null}</div>
                    <div className="vp-addr">{m.stop.address}</div>
                    <div className="vp-was">Back on the job about {clock5(m.back)} ({Math.round(m.awayMin)} min away) — so work finishes that much later.</div>
                    {stopTools(m.stop, m, d)}
                  </div>
                </div>
              </div>
            ))}
            {view.entries.length > 0 && <div className="vp-leg"><Car size={13} /> Leave {startName(d)}{view.leave != null ? ` at ${clock5(view.leave)}` : ""}</div>}
            {view.entries.map((e, i) => {
              const s = d.stops.find((x) => x.id === e.id);
              const shift = e.preferred != null ? r5(e.start) - e.preferred : null;
              const orderIds = view.entries.map((x) => x.id);
              const dragging = drag && drag.date === d.date;
              const others = dragging ? orderIds.filter((x) => x !== drag.id) : [];
              const lineHere = dragging && !drag.overDay && e.id !== drag.id && others[drag.index] === e.id;
              return (
                <div key={e.id} data-stop-id={e.id}>
                  {lineHere && <div className="vp-drop-line" />}
                  <div className="vp-leg"><Car size={13} /> {Math.round(e.driveMin)} min drive</div>
                  <div className={`vp-stop${e.lateBy > 0 ? " late" : ""}${dragging && drag.id === e.id ? " vp-dragging" : ""}`}>
                    <div className="vp-time vp-grip" {...gripProps(e.id, d.date, orderIds)} title="Hold and drag to reorder, or drop on a day above">
                      <strong>{clock5(e.start)}</strong>
                      <span>{clock5(e.end)}</span>
                      <GripVertical size={16} className="vp-grip-icon" />
                    </div>
                    <div className="vp-body">
                      <div className="vp-name">{i + 1}. {s.name}{s.jobType ? <span className="vp-type">{s.jobType}</span> : null}{s.movedFrom ? <span className="vp-badge moved">moved from {dayTitle(s.movedFrom)}</span> : null}{s.placed ? <span className="vp-badge placed">placed here</span> : null}</div>
                      <div className="vp-addr">{s.address}</div>
                      {e.preferred != null && (
                        <div className={`vp-was${Math.abs(shift) >= 15 ? " moved" : ""}`}>
                          {Math.abs(shift) < 15 ? `Keeps your ${fmtClock(e.preferred)}` : `Was ${fmtClock(e.preferred)} — ${shift < 0 ? `${Math.abs(shift)} min earlier` : `${shift} min later`}`}
                          {e.lateBy > 0 ? ` · ${e.lateBy} min late` : ""}
                        </div>
                      )}
                      {s.notBefore != null && <div className="vp-was moved">Available from {fmtClock(s.notBefore)} onwards{s.notAfter != null ? `, done before ${fmtClock(s.notAfter)}` : ""}</div>}
                      {s.notBefore == null && s.notAfter != null && <div className="vp-was moved">Needs to be done before {fmtClock(s.notAfter)}</div>}
                      {stopTools(s, e, d)}
                    </div>
                  </div>
                </div>
              );
            })}
            {drag && drag.date === d.date && !drag.overDay && drag.index >= view.entries.length - 1 && <div className="vp-drop-line" />}
            {view.entries.length > 0 && <div className="vp-leg"><Car size={13} /> Then about {Math.round(view.endLegMin)} min {planned.hasHome ? "home to Matilda St" : "back to Burleigh"}</div>}
          </div>

          {d.moved.length > 0 && (
            <div className="over-warning"><AlertTriangle size={14} /> Too much for this day, so {d.moved.map((s) => s.name).join(", ")} {d.moved.length === 1 ? "is" : "are"} suggested for the next Saturday instead.</div>
          )}

          <div className="calc-trigger-row" style={{ marginTop: 14 }}>
            <button className="btn-primary" onClick={() => apply([d.date])}><Check size={15} /> Save this day's times</button>
            <button className="btn-ghost" onClick={() => apply(planDates)}>Save all days</button>
            <button className="btn-ghost" onClick={() => copyDay(d)}><Copy size={14} /> Copy as text</button>
            {routeLink(d) && <a className="btn-ghost" href={routeLink(d)} target="_blank" rel="noreferrer"><MapIcon size={14} /> Whole route in Maps</a>}
          </div>
          <p className="calc-note">Saving writes each visit's date and time onto its lead (moved visits get their new day), so they show in the calendar here and on your iPhone. Nothing is sent to clients — you'd still tell them about any time that changed.</p>
        </div>
      )}

      {allStops.length > 0 && (
        <div className="panel">
          <div className="panel-head"><Smartphone size={16} /><span>Texts and your phone</span></div>
          <details open={showSms} onToggle={(e) => setShowSms(e.currentTarget.open)}>
            <summary className="vp-summary-link">The "On my way" text</summary>
            <p className="calc-note">Tapping <strong>On my way</strong> on a visit works out when you'll really arrive from where you are (it asks for your location), then opens Messages with this text, ready to send. It comes from your own number, so replies land in your Messages. Use <code>{"{name}"}</code> and <code>{"{eta}"}</code>.</p>
            <textarea className="vp-sms" rows={3} value={saved.smsTemplate} onChange={(e) => patchSaved({ smsTemplate: e.target.value })} />
            <button className="link-btn" onClick={() => patchSaved({ smsTemplate: DEFAULT_SMS })}>Reset to the original wording</button>
          </details>
          <details>
            <summary className="vp-summary-link">Get client texts into the hub automatically (iPhone)</summary>
            <ol className="vp-steps">
              <li>On your iPhone open <strong>Shortcuts → Automation → +  → Message</strong>. Leave <em>Sender</em> blank (or pick contacts) and choose <strong>Run Immediately</strong>.</li>
              <li>Add the action <strong>Get Contents of URL</strong>. URL: <code>{typeof window !== "undefined" ? `${window.location.origin}/api/leads/inbound-text` : "/api/leads/inbound-text"}</code></li>
              <li>Method <strong>POST</strong>. Headers: <code>x-api-key</code> = your phone-agent key (the same one the voice agent uses), and <code>Content-Type</code> = <code>application/json</code>. Request body <strong>JSON</strong> with two fields: <code>from</code> = the message's <em>Sender</em> (phone number) and <code>text</code> = the message's <em>Content</em>.</li>
              <li>That's it. When a client who is a lead texts you, the text is added to their notes and any "free from 3:30" style availability is picked up for the planner. Texts from anyone who isn't a lead are ignored and not stored.</li>
            </ol>
            <p className="calc-note">Or do it by hand any time with <strong>Paste a text</strong> on a visit (or in a lead).</p>
          </details>
        </div>
      )}

      {editLead && (
        <LeadModal
          initial={editLead}
          onClose={() => setEditLead(null)}
          onSave={(data) => { setLeads((rows) => rows.map((l) => (l.id === data.id ? data : l))); setEditLead(null); }}
          onDelete={() => { setLeads((rows) => rows.filter((l) => l.id !== editLead.id)); setEditLead(null); }}
          onQuote={null}
        />
      )}

      {textFor && (
        <TextImportModal
          lead={leads.find((l) => l.id === textFor.leadId) || { name: textFor.name, notes: "" }}
          onClose={() => setTextFor(null)}
          onApply={(patch) => {
            setLeads((rows) => rows.map((l) => (l.id === textFor.leadId ? { ...l, ...patch } : l)));
            const did = [patch.address && "address", patch.visitDate && "visit day", patch.notes !== undefined && patch.notes !== (leads.find((l) => l.id === textFor.leadId)?.notes ?? "") && "notes"].filter(Boolean);
            setNote(`Updated ${textFor.name}'s ${did.length ? did.join(" and ") : "details"}.`);
            setTextFor(null);
          }}
        />
      )}
    </div>
  );
}

// ---------- App shell ----------
const TABS = [
  { key: "dashboard", label: "Board", icon: LayoutGrid },
  { key: "leads", label: "Leads", icon: Users },
  { key: "visits", label: "Visit planner", icon: Route },
  { key: "clients", label: "Clients", icon: UserCircle },
  { key: "quotes", label: "Quotes", icon: FileText },
  { key: "invoices", label: "Invoices", icon: Receipt },
  { key: "materials", label: "Materials", icon: Boxes },
  { key: "shopping", label: "Shopping list", icon: ShoppingCart },
  { key: "finances", label: "Finances", icon: Wallet },
];

export default function HubApp() {
  const [tab, setTab] = useState("dashboard");
  const [pendingNewFrom, setPendingNewFrom] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Tables whose last save failed (lib/storage.js reports each save); cleared as soon as a later save works.
  const [saveErrors, setSaveErrors] = useState({});
  const [skippedCols, setSkippedCols] = useState({}); // saved, but these columns don't exist in the database yet
  useEffect(() => {
    const onSave = (e) => {
      const { ok, table, message, skipped } = e.detail || {};
      setSaveErrors((s) => {
        const next = { ...s };
        if (ok) delete next[table];
        else next[table] = message || "unknown error";
        return next;
      });
      if (ok) setSkippedCols((s) => ({ ...s, [table]: skipped || [] }));
    };
    window.addEventListener("hub-save", onSave);
    return () => window.removeEventListener("hub-save", onSave);
  }, []);

  const [leads, setLeads, leadsLoaded] = usePersistedList("lyons:leads");
  const [quotes, setQuotes, quotesLoaded] = usePersistedList("lyons:quotes");
  const [invoices, setInvoices, invoicesLoaded] = usePersistedList("lyons:invoices");
  const [materials, setMaterials, materialsLoaded] = usePersistedList("lyons:materials");
  const [expenses, setExpenses, expensesLoaded] = usePersistedList("lyons:expenses");
  const [settings, setSettings, settingsLoaded] = usePersistedValue("lyons:settings", { consumption: 10.5, fuelPrice: 1.85, tipRatePerMetre: 10, nextDocNumber: 458 });

  const allLoaded = leadsLoaded && quotesLoaded && invoicesLoaded && materialsLoaded && expensesLoaded && settingsLoaded;

  // ----- Undo for deletes -----
  // lib/storage.js announces every delete made in the app ("hub-deleted"). They're kept for two weeks (on this device) so a
  // lead, quote or invoice deleted by accident can be put back, right away from the Undo bar or later from the header button.
  const TRASH_KEY = "lyons:trash";
  const TRASH_DAYS = 14;
  const [trash, setTrash] = useState([]);
  const [toast, setToast] = useState(null); // the delete the Undo bar is offering right now
  const [trashOpen, setTrashOpen] = useState(false);
  const trashSkipFirstSave = useRef(true);
  useEffect(() => {
    const cutoff = Date.now() - TRASH_DAYS * 86400000;
    try { setTrash((JSON.parse(window.localStorage.getItem(TRASH_KEY) || "[]") || []).filter((t) => t.at > cutoff).slice(0, 60)); } catch {}
  }, []);
  useEffect(() => {
    if (trashSkipFirstSave.current) { trashSkipFirstSave.current = false; return; } // the empty list before it has been read back
    try { window.localStorage.setItem(TRASH_KEY, JSON.stringify(trash)); } catch {}
  }, [trash]);
  useEffect(() => {
    const label = (table, r) => [r.name || r.clientName || r.description || r.title || (table === "expenses" ? r.category : "") || "Item", r.docNumber].filter(Boolean).join(" ");
    const noun = { leads: "lead", quotes: "quote", invoices: "invoice", materials: "material", expenses: "expense" };
    const onDeleted = (e) => {
      const { table, rows } = e.detail || {};
      if (!noun[table] || !rows?.length) return;
      const entries = rows.map((r) => ({ key: `${table}:${r.id}:${Date.now()}`, table, kind: noun[table], label: label(table, r), row: r, at: Date.now() }));
      setTrash((t) => [...entries, ...t].slice(0, 60));
      setToast({ key: entries[0].key, text: rows.length === 1 ? `Deleted ${noun[table]} “${entries[0].label}”` : `Deleted ${rows.length} ${noun[table]}s`, entries });
    };
    window.addEventListener("hub-deleted", onDeleted);
    return () => window.removeEventListener("hub-deleted", onDeleted);
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 12000);
    return () => clearTimeout(t);
  }, [toast]);
  const restore = (entries) => {
    const setters = { leads: setLeads, quotes: setQuotes, invoices: setInvoices, materials: setMaterials, expenses: setExpenses };
    for (const en of entries) setters[en.table]((rows) => (rows.some((r) => r.id === en.row.id) ? rows : [en.row, ...rows]));
    const gone = new Set(entries.map((e) => e.key));
    setTrash((t) => t.filter((x) => !gone.has(x.key)));
    setToast(null);
  };

  const go = (t, opts) => {
    setTab(t);
    if (opts?.newFromLead) setPendingNewFrom(opts.newFromLead);
  };

  const bumpDocNumber = () => setSettings((s) => ({ ...s, nextDocNumber: (Number(s.nextDocNumber) || 458) + 1 }));

  const handleExportData = () => {
    const payload = { exportedAt: new Date().toISOString(), leads, quotes, invoices, materials, expenses, settings };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lyons-fencing-hub-export-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="app">
      {!usingSupabase && (
        <div className="storage-banner">
          Running in local-only mode (no database connected) — data is saved in this browser only. Connect Supabase to sync properly.
        </div>
      )}
      {Object.keys(saveErrors).length > 0 && (
        <div className="save-error-banner" role="alert">
          <AlertTriangle size={16} />
          <span>
            Your last change to {Object.keys(saveErrors).join(" and ")} did not save, so it will be lost if you close or reload this page.
            <small>{Object.values(saveErrors)[0]}</small>
          </span>
        </div>
      )}
      {Object.values(skippedCols).flat().length > 0 && Object.keys(saveErrors).length === 0 && (
        <div className="save-error-banner warn" role="status">
          <AlertTriangle size={16} />
          <span>
            Saved, but your database needs a small update first, so {[...new Set(Object.values(skippedCols).flat())].join(", ")} {Object.values(skippedCols).flat().length === 1 ? "wasn't" : "weren't"} kept.
            <small>Run the pending SQL update in Supabase ({[...new Set(Object.values(skippedCols).flat())].some((c) => ["lastFollowUp", "lastChase"].includes(c)) ? "supabase/migration-7-text-reminders.sql" : "supabase/migration-6-job-duration.sql"}) and it'll save from then on.</small>
          </span>
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">LF</div>
          <div>
            <div className="brand-name">Lyons Fencing & Services</div>
            <div className="brand-sub">Business hub</div>
          </div>
        </div>
        <button className="icon-btn settings-btn undo-btn" onClick={() => setTrashOpen(true)} title="Recently deleted — put things back">
          <Undo2 size={18} />
          {trash.length > 0 && <span className="undo-count">{trash.length > 9 ? "9+" : trash.length}</span>}
        </button>
        <button className="icon-btn settings-btn" onClick={() => setCalendarOpen(true)} title="iPhone calendar"><CalendarDays size={18} /></button>
        <button className="icon-btn settings-btn" onClick={handleExportData} title="Export all data"><Download size={18} /></button>
        <button className="icon-btn settings-btn" onClick={() => setSettingsOpen(true)}><Settings size={18} /></button>
      </header>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.key} className={`tab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            <t.icon size={16} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="content">
        {!allLoaded ? (
          <div className="loading">Loading your data…</div>
        ) : (
          <>
            {tab === "dashboard" && <Dashboard leads={leads} quotes={quotes} invoices={invoices} materials={materials} expenses={expenses} go={go} setLeads={setLeads} setQuotes={setQuotes} setInvoices={setInvoices} />}
            {tab === "leads" && <Leads leads={leads} setLeads={setLeads} go={go} />}
            {tab === "visits" && <VisitPlanner leads={leads} quotes={quotes} setLeads={setLeads} setQuotes={setQuotes} go={go} />}
            {tab === "clients" && <Clients leads={leads} quotes={quotes} invoices={invoices} go={go} />}
            {tab === "quotes" && <Quotes quotes={quotes} setQuotes={setQuotes} setLeads={setLeads} invoices={invoices} setInvoices={setInvoices} pendingNewFrom={pendingNewFrom} clearPending={() => setPendingNewFrom(null)} settings={settings} materials={materials} bumpDocNumber={bumpDocNumber} go={go} />}
            {tab === "invoices" && <Invoices invoices={invoices} setInvoices={setInvoices} settings={settings} bumpDocNumber={bumpDocNumber} />}
            {tab === "materials" && <Materials materials={materials} setMaterials={setMaterials} />}
            {tab === "shopping" && <ShoppingList quotes={quotes} go={go} />}
            {tab === "finances" && <Finances invoices={invoices} expenses={expenses} setExpenses={setExpenses} quotes={quotes} settings={settings} />}
          </>
        )}
      </main>

      {toast && (
        <div className="undo-toast" role="status">
          <span>{toast.text}</span>
          <button onClick={() => restore(toast.entries)}><Undo2 size={15} /> Undo</button>
          <button className="undo-x" onClick={() => setToast(null)} aria-label="Dismiss"><X size={15} /></button>
        </div>
      )}
      {trashOpen && (
        <Modal title="Recently deleted" onClose={() => setTrashOpen(false)}>
          {trash.length === 0 ? (
            <p className="calc-note">Nothing deleted recently. Anything you delete is kept here for {TRASH_DAYS} days so you can put it back.</p>
          ) : (
            <>
              <p className="calc-note">Kept for {TRASH_DAYS} days on this device. Restore puts it back exactly as it was.</p>
              {trash.map((t) => (
                <div key={t.key} className="trash-row">
                  <div>
                    <strong>{t.label}</strong>
                    <span>{t.kind} · deleted {new Date(t.at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                  </div>
                  <button className="btn-primary small" onClick={() => restore([t])}><Undo2 size={13} /> Restore</button>
                </div>
              ))}
            </>
          )}
        </Modal>
      )}
      <GoogleSyncRunner />
      <InboxRunner />
      {calendarOpen && <CalendarModal onClose={() => setCalendarOpen(false)} />}
      {settingsOpen && <SettingsModal settings={settings} onSave={(s) => { setSettings(s); setSettingsOpen(false); }} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
