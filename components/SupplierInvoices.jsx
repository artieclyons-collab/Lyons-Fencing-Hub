"use client";
// Supplier invoices (Our Town, Bunnings...): add a photo or PDF, it's read, you check it and pick the job, and that job's materials
// cost becomes what was really paid instead of the quote's estimate. They're kept in the hub (lib/supplierInvoice.js).
import { useRef, useState, useMemo } from "react";
import { Camera, X, Trash2, Check } from "lucide-react";
import { money, today } from "@/lib/logic";
import { readSupplierInvoice } from "@/lib/ai";
import { suggestJobs, shortDate } from "@/lib/finances";
import { isSupplierRow, supplierFromRow, supplierRow, isPendingRow, pendingFromRow } from "@/lib/supplierInvoice";

const blankDoc = () => ({ supplier: "", invoiceNumber: "", date: today(), deliveryAddress: "", deliveryIncGst: 0, lines: [], totalIncGst: "", isOrderOnly: false });
const jobLabel = (j) => `${j.name}${j.docNumber ? ` ${j.docNumber}` : ""}${j.address ? ` · ${j.address}` : ""}`;

export default function SupplierInvoices({ jobs, expenses, setExpenses }) {
  const input = useRef(null);
  const [reading, setReading] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState([]); // invoices just read, to check before saving
  const [manualNote, setManualNote] = useState(false); // reading isn't switched on (no Anthropic key), so the details are typed in

  const options = useMemo(() => jobs.filter((j) => j.quote).sort((a, b) => String(b.lastDate).localeCompare(String(a.lastDate))), [jobs]);
  const saved = useMemo(
    () => expenses.filter(isSupplierRow).map((row) => ({ row, doc: supplierFromRow(row) })).filter((x) => x.doc).sort((a, b) => String(b.doc.date).localeCompare(String(a.doc.date))),
    [expenses]
  );
  const savedTotal = saved.reduce((s, x) => s + x.doc.total, 0);

  // Invoices that arrived by email and were read automatically: they wait here until you've checked them and picked the job.
  const pending = useMemo(
    () => expenses.filter(isPendingRow).map(pendingFromRow).filter(Boolean).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))),
    [expenses]
  );
  const [picks, setPicks] = useState({}); // waiting invoice id -> the job you picked
  const suggestFor = (p) => {
    const sugg = suggestJobs(jobs, p.doc.deliveryAddress);
    return sugg.length === 1 ? sugg[0].quote.id : "";
  };
  const addPending = (p) => {
    const row = supplierRow({ ...p.doc, quoteId: picks[p.id] ?? suggestFor(p) });
    setExpenses((es) => [row, ...es.filter((e) => e.id !== row.id && e.id !== p.id)]);
  };
  const skipPending = (p) => {
    if (window.confirm(`Skip this ${p.doc.supplier || "supplier"} invoice (${money(p.doc.totalIncGst)})? It won't be added to any job.`)) setExpenses((es) => es.filter((e) => e.id !== p.id));
  };

  const onFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (files.length === 0) return;
    setError("");
    const out = [];
    for (let i = 0; i < files.length; i++) {
      setReading(`Reading ${i + 1} of ${files.length}…`);
      try {
        const doc = await readSupplierInvoice(files[i]);
        const sugg = suggestJobs(jobs, doc.deliveryAddress);
        out.push({ key: `${Date.now()}-${i}`, name: files[i].name, doc, quoteId: sugg.length === 1 ? sugg[0].quote.id : "", skip: !!doc.isOrderOnly });
      } catch (err) {
        if (/isn't set up/i.test(err.message || "")) {
          // no key for reading: still let the invoice be added, typed in
          setManualNote(true);
          out.push({ key: `${Date.now()}-${i}`, name: files[i].name, doc: blankDoc(), quoteId: "", skip: false });
        } else setError(`${files[i].name}: ${err.message || "couldn't be read"}`);
      }
    }
    setReading("");
    if (out.length) setDrafts(out);
  };

  const setDoc = (key, patch) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch, doc: patch.doc ? { ...d.doc, ...patch.doc } : d.doc } : d)));
  const closeDrafts = () => { setDrafts([]); setManualNote(false); };
  const saveAll = () => {
    const rows = drafts.filter((d) => !d.skip).map((d) => supplierRow({ ...d.doc, date: d.doc.date || today(), quoteId: d.quoteId }));
    if (rows.length) setExpenses((es) => [...rows, ...es.filter((e) => !rows.some((r) => r.id === e.id))]);
    closeDrafts();
  };
  const reassign = (p, quoteId) => {
    const row = supplierRow({ supplier: p.doc.supplier, invoiceNumber: p.doc.number, date: p.doc.date, deliveryAddress: p.doc.address, deliveryIncGst: p.doc.delivery, lines: p.doc.lines, totalIncGst: p.doc.total, quoteId }, p.row.id);
    setExpenses((es) => es.map((e) => (e.id === row.id ? { ...e, ...row } : e)));
  };
  const remove = (p) => {
    if (window.confirm(`Delete this ${p.doc.supplier || "supplier"} invoice (${money(p.doc.total)})? The job goes back to the quote's estimate.`)) setExpenses((es) => es.filter((e) => e.id !== p.row.id));
  };

  return (
    <div className="panel">
      <div className="panel-head"><Camera size={16} /><span>Supplier invoices — real materials costs</span></div>
      <input ref={input} type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={onFiles} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn-primary" onClick={() => input.current?.click()} disabled={!!reading}><Camera size={15} /> {reading || "Add supplier invoice"}</button>
        <button className="btn-ghost" onClick={() => { setManualNote(true); setDrafts([{ key: `m${Date.now()}`, name: "typed", doc: blankDoc(), quoteId: "", skip: false }]); }} disabled={!!reading}>Type one in</button>
        <span className="calc-note" style={{ margin: 0 }}>A photo, screenshot or PDF from Our Town, Bunnings or anyone. Pick the job and its materials cost becomes what you really paid.</span>
      </div>
      {error && <p className="calc-note" style={{ color: "var(--bad)" }}>{error}</p>}

      {pending.length > 0 && (
        <div className="calc-preview" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>From your email, check these ({pending.length})</div>
          {pending.map((p) => (
            <div key={p.id} className="fin-item" style={{ paddingBottom: 8 }}>
              <div className="fin-row" style={{ cursor: "default", flexWrap: "wrap" }}>
                <div className="fin-main">
                  <div className="fin-title">{p.doc.supplier || p.from || "Supplier"}{p.doc.invoiceNumber ? <span className="fin-doc"> {p.doc.invoiceNumber}</span> : ""}</div>
                  <div className="fin-meta">{p.doc.date ? shortDate(p.doc.date) : ""}{p.doc.deliveryAddress ? ` · ${p.doc.deliveryAddress}` : ""} · {p.doc.lines.length} {p.doc.lines.length === 1 ? "line" : "lines"}</div>
                </div>
                <div className="fin-amt bad">{money(p.doc.totalIncGst)}</div>
                <select className="search-filter" style={{ width: "100%" }} value={picks[p.id] ?? suggestFor(p)} onChange={(e) => setPicks((x) => ({ ...x, [p.id]: e.target.value }))} aria-label="Job">
                  <option value="">Job: match by delivery address</option>
                  {options.map((j) => <option key={j.key} value={j.quote.id}>{jobLabel(j)}</option>)}
                </select>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button className="btn-primary small" onClick={() => addPending(p)}><Check size={13} /> Add to job</button>
                  <button className="btn-ghost small" onClick={() => skipPending(p)}>Skip</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {saved.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>{saved.length} added · {money(savedTotal)} inc. GST</summary>
          {saved.map((p) => (
            <div key={p.row.id} className="fin-item">
              <div className="fin-row" style={{ cursor: "default", flexWrap: "wrap" }}>
                <div className="fin-main">
                  <div className="fin-title">{p.doc.supplier || "Supplier"}{p.doc.number ? <span className="fin-doc"> {p.doc.number}</span> : ""}</div>
                  <div className="fin-meta">{p.doc.date ? shortDate(p.doc.date) : ""}{p.doc.address ? ` · ${p.doc.address}` : ""}</div>
                </div>
                <div className="fin-amt bad">{money(p.doc.total)}</div>
                <button className="icon-btn" onClick={() => remove(p)} aria-label="Delete"><Trash2 size={14} /></button>
                <select className="search-filter" style={{ width: "100%" }} value={p.doc.quoteId || ""} onChange={(e) => reassign(p, e.target.value)} aria-label="Job">
                  <option value="">Job: match by delivery address</option>
                  {options.map((j) => <option key={j.key} value={j.quote.id}>{jobLabel(j)}</option>)}
                </select>
              </div>
            </div>
          ))}
        </details>
      )}

      {drafts.length > 0 && (
        <div className="modal-overlay" onClick={closeDrafts}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><span>Check the invoice{drafts.length > 1 ? "s" : ""}</span><button className="icon-btn" onClick={closeDrafts} aria-label="Close"><X size={20} /></button></div>
            <div className="modal-body">
              {manualNote && <p className="calc-note" style={{ marginTop: 0 }}>Type the supplier, date and total from the invoice (the total including GST), and pick the job. When the hub has an Anthropic key set up it reads these from the photo or PDF for you.</p>}
              {drafts.map((d) => {
                const linesTotal = d.doc.lines.reduce((s, l) => s + l.totalIncGst, 0) + d.doc.deliveryIncGst;
                return (
                  <div key={d.key} className="calc-preview" style={{ marginBottom: 12, opacity: d.skip ? 0.55 : 1 }}>
                    <div className="field-pair">
                      <label className="field"><span>Supplier</span><input value={d.doc.supplier} onChange={(e) => setDoc(d.key, { doc: { supplier: e.target.value } })} /></label>
                      <label className="field"><span>Invoice no.</span><input value={d.doc.invoiceNumber} onChange={(e) => setDoc(d.key, { doc: { invoiceNumber: e.target.value } })} /></label>
                    </div>
                    <div className="field-pair">
                      <label className="field"><span>Date</span><input type="date" value={d.doc.date} onChange={(e) => setDoc(d.key, { doc: { date: e.target.value } })} /></label>
                      <label className="field"><span>Total inc. GST ($)</span><input inputMode="decimal" value={d.doc.totalIncGst} onChange={(e) => setDoc(d.key, { doc: { totalIncGst: e.target.value } })} /></label>
                    </div>
                    <label className="field"><span>Which job is it for?{d.doc.deliveryAddress ? ` (delivered to ${d.doc.deliveryAddress})` : ""}</span>
                      <select value={d.quoteId} onChange={(e) => setDoc(d.key, { quoteId: e.target.value })}>
                        <option value="">Not sure: match by delivery address</option>
                        {options.map((j) => <option key={j.key} value={j.quote.id}>{jobLabel(j)}</option>)}
                      </select>
                    </label>
                    <div className="calc-note" style={{ margin: 0 }}>
                      {d.doc.lines.length} {d.doc.lines.length === 1 ? "line" : "lines"}{d.doc.deliveryIncGst ? ` + ${money(d.doc.deliveryIncGst)} delivery` : ""} = {money(linesTotal)}
                      {Math.abs(linesTotal - Number(d.doc.totalIncGst)) > 1 ? " — doesn't match the total, check it" : ""}
                    </div>
                    {d.doc.isOrderOnly && <div className="calc-note" style={{ color: "var(--warn, #c9873a)" }}>This looks like an order, not a tax invoice, so it's skipped. Tick below to add it anyway.</div>}
                    <label className="calc-note" style={{ display: "flex", gap: 6, alignItems: "center", margin: "6px 0 0" }}>
                      <input type="checkbox" checked={d.skip} onChange={(e) => setDoc(d.key, { skip: e.target.checked })} /> Don't add this one
                    </label>
                  </div>
                );
              })}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={closeDrafts}>Cancel</button>
              <button className="btn-primary" onClick={saveAll} disabled={drafts.every((d) => d.skip) || drafts.some((d) => !d.skip && !(Number(d.doc.totalIncGst) > 0))}><Check size={15} /> Add {drafts.filter((d) => !d.skip).length}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
