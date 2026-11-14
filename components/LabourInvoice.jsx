"use client";
// Labourer invoice: pick the days and hours, and it makes the sub-contractor invoice (Usher → Lyons Fencing) as a PDF.
// Sending it texts Usher a link to the PDF (he opens it, saves it and emails it to you); the invoice number then moves on by one.
// What's typed is kept on this device (draft, rate, bank details, past invoices) so it's all still there next time.
import { useState, useEffect, useMemo } from "react";
import { X, Plus, Download, FileText, Trash2, CalendarDays, Send } from "lucide-react";
import { uid, today, money } from "@/lib/logic";
import { addDaysIso } from "@/lib/jobSchedule";
import { smsLink } from "@/lib/introText";
import { LABOURER, PAYER, fmtAbn, parseHours, labourTotals, fmtHours, dayLabel, longDate, paidHours, encodeLabour, isLabourRow, labourRow, labourFromRow } from "@/lib/labourInvoice";

const KEY = "lyons:labour-invoice";
const QUICK_HOURS = [6, 7, 8, 9, 10];
const FRESH = () => ({
  number: 1, date: today(), rate: LABOURER.rate, lunchMin: LABOURER.lunchMin,
  days: [], bank: { ...LABOURER.bank }, notes: "", history: [],
});

const load = () => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) || "null");
    if (raw && typeof raw === "object") {
      const base = FRESH();
      const bank = { ...base.bank };
      for (const k of Object.keys(bank)) if (raw.bank?.[k]) bank[k] = raw.bank[k]; // a blank saved value never hides his real details
      return { ...base, ...raw, bank, days: Array.isArray(raw.days) ? raw.days : [], history: Array.isArray(raw.history) ? raw.history : [] };
    }
  } catch { /* private window or bad data: start fresh */ }
  return FRESH();
};

const dow = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };
// the day after `iso`, skipping Sundays (Saturdays are worked)
const nextDay = (iso) => { let d = addDaysIso(iso, 1); if (dow(d) === 0) d = addDaysIso(d, 1); return d; };
const periodOf = (rows) => (rows.length ? (rows[0].date === rows[rows.length - 1].date ? longDate(rows[0].date) : `${longDate(rows[0].date)} – ${longDate(rows[rows.length - 1].date)}`) : "");
const shortPeriod = (rows) => (rows.length ? (rows[0].date === rows[rows.length - 1].date ? dayLabel(rows[0].date) : `${dayLabel(rows[0].date)} – ${dayLabel(rows[rows.length - 1].date)}`) : "");

export default function LabourInvoice({ addresses = [], expenses = [], setExpenses, onClose, onPreview }) {
  const [inv, setInv] = useState(null); // null until the saved draft has loaded on this device
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { setInv(load()); }, []);
  useEffect(() => {
    if (!inv) return;
    try { window.localStorage.setItem(KEY, JSON.stringify(inv)); } catch { /* not saved on this device */ }
  }, [inv]);

  const totals = useMemo(() => (inv ? labourTotals(inv) : { rows: [], totalHours: 0, total: 0 }), [inv]);

  // Invoices are kept in the hub (see labourRow in lib/labourInvoice.js), so every device and the Finances tab see them.
  const past = useMemo(
    () => expenses.filter(isLabourRow).map((row) => ({ row, doc: labourFromRow(row) })).filter((x) => x.doc).sort((a, b) => Number(b.doc.number) - Number(a.doc.number)),
    [expenses]
  );
  const saveToHub = (doc) => {
    const row = labourRow(doc);
    setExpenses?.((es) => (es.some((e) => e.id === row.id) ? es.map((e) => (e.id === row.id ? { ...e, ...row } : e)) : [row, ...es]));
  };
  // Invoices an earlier version kept only on this device are moved into the hub the first time it's opened.
  useEffect(() => {
    if (!inv || !setExpenses || inv.history.length === 0) return;
    for (const h of inv.history) if (h?.doc) saveToHub(h.doc);
    setInv((i) => ({ ...i, history: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv?.history?.length]);
  // A fresh invoice never reuses a number that's already in the hub (a new device starts at 1, for instance).
  const topNumber = Math.max(0, ...past.map((p) => Number(p.doc.number) || 0));
  useEffect(() => {
    if (inv && inv.days.length === 0 && (Number(inv.number) || 0) <= topNumber) setInv((i) => ({ ...i, number: topNumber + 1 }));
  }, [inv?.days?.length, inv?.number, topNumber]);
  if (!inv) return null;

  const set = (k, v) => setInv((i) => ({ ...i, [k]: v }));
  const setBank = (k, v) => setInv((i) => ({ ...i, bank: { ...i.bank, [k]: v } }));
  const setDay = (id, k, v) => setInv((i) => ({ ...i, days: i.days.map((d) => (d.id === id ? { ...d, [k]: v } : d)) }));
  const lastDay = [...inv.days].sort((a, b) => a.date.localeCompare(b.date)).pop();

  // the day after the last one added (today if it's empty), same job address as the last day
  const addDay = (hours) => {
    const date = lastDay ? nextDay(lastDay.date) : dow(today()) === 0 ? nextDay(today()) : today();
    setInv((i) => ({ ...i, days: [...i.days, { id: uid(), date, hours: String(hours ?? lastDay?.hours ?? 8), address: lastDay?.address || "" }] }));
  };
  // The rest of that working week up to Friday (a whole Mon–Fri if the last day was Fri or later), same hours and address as the last day
  const addWeek = () => {
    let d = lastDay ? addDaysIso(lastDay.date, 1) : today();
    while (dow(d) === 0 || dow(d) === 6) d = addDaysIso(d, 1);
    const days = [];
    for (;;) {
      days.push({ id: uid(), date: d, hours: String(lastDay?.hours ?? 8), address: lastDay?.address || "" });
      if (dow(d) === 5) break;
      d = addDaysIso(d, 1);
    }
    setInv((i) => ({ ...i, days: [...i.days, ...days] }));
  };

  // Once an invoice has gone out (downloaded or texted) it's kept in "Past invoices" and the next one starts, numbered one higher.
  const finish = (sent) => {
    saveToHub(sent);
    setInv((i) => {
      const top = Math.max(Number(i.number) || 0, Number(sent.number) || 0, ...past.map((p) => Number(p.doc.number) || 0));
      return { ...i, number: top + 1, date: today(), days: [], notes: "" };
    });
  };

  const snapshot = () => { const { history, ...rest } = inv; return { ...rest, days: inv.days.map((d) => ({ ...d })) }; }; // what goes out, without the past-invoices list

  const problems = [];
  if (totals.rows.length === 0) problems.push("Add at least one day with its hours.");
  if (inv.days.some((d) => parseHours(d.hours) == null || !d.date)) problems.push("A day has hours I can't read — use e.g. 8, 7.5 or 7-3:30.");

  const getPdf = async (doc) => {
    const res = await fetch("/api/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "labour", data: doc }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `PDF generation failed (${res.status})`);
    return res.blob();
  };
  const run = async (fn) => {
    setBusy(true); setError(""); setNote("");
    try { await fn(); } catch (e) { setError(e.message || "Couldn't make the PDF — try again."); } finally { setBusy(false); }
  };
  const saveFile = async (doc) => {
    const url = URL.createObjectURL(await getPdf(doc));
    const a = document.createElement("a");
    a.href = url; a.download = `Invoice ${doc.number} Usher Oakenfull.pdf`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const textDoc = (doc) => {
    const t = labourTotals(doc);
    const link = `${window.location.origin}/api/labour-pdf?d=${encodeLabour(doc)}`;
    const body = `Hey Usher,\n\nInvoice ${doc.number} for ${money(t.total)} (${shortPeriod(t.rows)}) is ready. Open the link, save the PDF and email it through to me please.\n\n${link}\n\nCheers,\nArtie`;
    window.location.href = smsLink(LABOURER.phone, body);
  };

  const download = () => run(async () => {
    const sent = snapshot();
    await saveFile(sent);
    finish(sent);
    setNote(`Downloaded invoice ${sent.number}. Now on invoice ${Number(sent.number) + 1}.`);
  });
  const text = () => {
    const sent = snapshot();
    textDoc(sent);
    finish(sent);
    setNote(`Opened Messages to Usher for invoice ${sent.number} — press send there. Now on invoice ${Number(sent.number) + 1}.`);
  };

  // Opens a saved invoice to change; saving/sending it again replaces that invoice (same number).
  const reopen = (doc) => {
    if (inv.days.length > 0 && !window.confirm("This replaces the days you've got on the screen now. Carry on?")) return;
    setInv((i) => ({ ...i, number: doc.number, date: doc.date, rate: doc.rate, lunchMin: doc.lunchMin, bank: { ...i.bank, ...doc.bank }, notes: doc.notes || "", days: doc.days.map((d) => ({ ...d, hours: String(d.hours) })) }));
    setNote(`Invoice ${doc.number} is open to change. Download or text it again to save the new version.`);
  };
  const removeSaved = (p) => {
    if (!window.confirm(`Delete invoice ${p.doc.number} from the hub? The Finances labour figures drop it too.`)) return;
    setExpenses?.((es) => es.filter((e) => e.id !== p.row.id));
  };

  const ready = totals.rows.length > 0 && problems.length === 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Labourer invoice · {LABOURER.name}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="modal-body">
          <p className="calc-note" style={{ marginTop: 0 }}>
            Invoice <strong>{inv.number}</strong>. Add the days he worked and the hours on site. {inv.lunchMin} min lunch comes off every day (Saturdays too), at {money(inv.rate)}/hour — it doesn't show on the invoice. Billed to {PAYER.name} (ABN {fmtAbn(PAYER.abn)}), no GST.
          </p>

          <div className="line-items" style={{ gap: 8 }}>
            {inv.days.map((d) => {
              const worked = parseHours(d.hours);
              return (
                <div key={d.id} className="calc-preview" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input className="li-desc" type="date" value={d.date} onChange={(e) => setDay(d.id, "date", e.target.value)} style={{ flex: 1, minWidth: 0 }} />
                    <input
                      className="li-num" style={{ width: 84, borderColor: worked == null && d.hours ? "var(--bad)" : undefined }}
                      inputMode="decimal" placeholder="Hours" aria-label="Hours on site" value={d.hours}
                      onChange={(e) => setDay(d.id, "hours", e.target.value)}
                    />
                    <button type="button" className="icon-btn" onClick={() => set("days", inv.days.filter((x) => x.id !== d.id))} aria-label="Remove day"><Trash2 size={15} /></button>
                  </div>
                  <input className="li-desc" list="labour-addresses" placeholder="Job address (optional)" value={d.address} onChange={(e) => setDay(d.id, "address", e.target.value)} />
                  <div className="calc-note" style={{ margin: 0 }}>
                    {d.date ? dayLabel(d.date) : "Pick a date"}
                    {worked != null && d.date ? ` · ${fmtHours(worked)}h on site → ${fmtHours(paidHours(worked, inv.lunchMin))}h paid · ${money(paidHours(worked, inv.lunchMin) * (Number(inv.rate) || 0))}` : ""}
                    {d.date && dow(d.date) === 0 ? " · Sunday" : ""}
                  </div>
                </div>
              );
            })}
          </div>
          <datalist id="labour-addresses">{addresses.map((a) => <option key={a} value={a} />)}</datalist>

          <div style={{ margin: "10px 0 4px", fontSize: 12.5, color: "var(--text-dim)" }}>
            Add {lastDay ? `${dayLabel(nextDay(lastDay.date))}` : "a day"} with:
          </div>
          <div className="calc-trigger-row">
            {QUICK_HOURS.map((h) => <button key={h} type="button" className="btn-ghost small" onClick={() => addDay(h)}>{h}h</button>)}
            <button type="button" className="btn-ghost small" onClick={() => addDay()}><Plus size={13} /> Same as last</button>
            <button type="button" className="btn-ghost small" onClick={addWeek}><CalendarDays size={13} /> Fill the week (to Fri)</button>
          </div>
          <p className="calc-note" style={{ marginTop: 0 }}>Hours can be typed as 8, 7.5, or a start–finish like 7-3:30. They're the hours on site, before lunch comes off.</p>

          <p className="li-grand-total" style={{ marginBottom: 12 }}>
            {totals.rows.length} {totals.rows.length === 1 ? "day" : "days"} · {fmtHours(totals.totalHours)} paid hours · <strong>{money(totals.total)}</strong>
          </p>

          <details style={{ marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Invoice details &amp; bank details</summary>
            <div className="field-pair">
              <label className="field"><span>Invoice number</span><input inputMode="numeric" value={inv.number} onChange={(e) => set("number", e.target.value)} /></label>
              <label className="field"><span>Invoice date</span><input type="date" value={inv.date} onChange={(e) => set("date", e.target.value)} /></label>
            </div>
            <div className="field-pair">
              <label className="field"><span>Hourly rate ($)</span><input inputMode="decimal" value={inv.rate} onChange={(e) => set("rate", e.target.value)} /></label>
              <label className="field"><span>Lunch taken off (min/day)</span><input inputMode="numeric" value={inv.lunchMin} onChange={(e) => set("lunchMin", e.target.value)} /></label>
            </div>
            <label className="field"><span>Bank account name</span><input value={inv.bank.accountName} onChange={(e) => setBank("accountName", e.target.value)} /></label>
            <div className="field-pair">
              <label className="field"><span>BSB</span><input inputMode="numeric" value={inv.bank.bsb} onChange={(e) => setBank("bsb", e.target.value)} /></label>
              <label className="field"><span>Account number</span><input inputMode="numeric" value={inv.bank.accountNumber} onChange={(e) => setBank("accountNumber", e.target.value)} /></label>
            </div>
            <label className="field"><span>Notes on the invoice (optional)</span><textarea rows={2} value={inv.notes} onChange={(e) => set("notes", e.target.value)} /></label>
          </details>

          {past.length > 0 && (
            <details style={{ marginBottom: 12 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Past invoices ({past.length})</summary>
              {past.map((p) => {
                const t = labourTotals(p.doc);
                return (
                  <div key={p.row.id} className="calc-row" style={{ alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ flex: 1, minWidth: 160, color: "var(--text)", fontWeight: 400 }}>
                      <strong>#{p.doc.number}</strong> · {shortPeriod(t.rows)} · {fmtHours(t.totalHours)}h · {money(t.total)}
                    </span>
                    <button type="button" className="btn-ghost small" onClick={() => run(() => saveFile(p.doc))} disabled={busy}>PDF</button>
                    <button type="button" className="btn-ghost small" onClick={() => textDoc(p.doc)}>Text</button>
                    <button type="button" className="btn-ghost small" onClick={() => reopen(p.doc)}>Edit</button>
                    <button type="button" className="icon-btn" onClick={() => removeSaved(p)} aria-label="Delete invoice"><Trash2 size={14} /></button>
                  </div>
                );
              })}
            </details>
          )}

          {problems.length > 0 && <p className="calc-note" style={{ color: "var(--warn, #c9873a)" }}>{problems.join(" ")}</p>}
          {note && <p className="calc-note" style={{ color: "var(--hivis)" }}>{note}</p>}
          {error && <p className="calc-note" style={{ color: "var(--bad)" }}>{error}</p>}
        </div>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={() => onPreview?.(snapshot())} disabled={busy || totals.rows.length === 0}><FileText size={15} /> Preview</button>
          <button className="btn-ghost" onClick={download} disabled={busy || !ready}>
            <Download size={15} /> {busy ? "Making PDF…" : "Download PDF"}
          </button>
          <button className="btn-primary" onClick={text} disabled={busy || !ready} title="Opens Messages to Usher with a link to the invoice">
            <Send size={15} /> Text to Usher
          </button>
        </div>
      </div>
    </div>
  );
}
