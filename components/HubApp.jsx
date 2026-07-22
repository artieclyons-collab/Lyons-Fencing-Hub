"use client";
// Ported from the original Claude artifact (lyons-fencing-hub.jsx).
// Component structure and behaviour are unchanged — only the storage layer
// (Supabase instead of window.storage), the AI calls (server routes instead of
// direct API calls) and the document download (real PDF endpoint) differ.
import { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutGrid, Users, FileText, Receipt, Boxes, Wallet,
  Plus, X, Phone, MapPin, Trash2, ChevronRight,
  AlertTriangle, TrendingUp, TrendingDown, Check, Fuel, Settings, ClipboardPaste, Camera, CalendarDays, UserCircle, Download
} from "lucide-react";

import {
  JOB_TYPES, LEAD_STATUSES, QUOTE_STATUSES, INVOICE_STATUSES, EXPENSE_CATEGORIES,
  NOTE_SNIPPETS, JOB_TEMPLATES, PRESET_MATERIALS, statusColor,
} from "@/lib/constants";
import {
  uid, money, today, itemsTotal, gstBreakdown, addMonths, formatDateAU,
  buildFilename, suggestedNotes, calcMaterials, estFuelCost,
} from "@/lib/logic";
import { usePersistedList, usePersistedValue, usingSupabase } from "@/lib/storage";
import { lookupPrice, scanJobPhoto, estimateRouteDistance } from "@/lib/ai";
import { lookupSuburb } from "@/lib/geocode";
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
function Dashboard({ leads, quotes, invoices, materials, expenses, go }) {
  const activeLeads = leads.filter((l) => !["Won", "Lost"].includes(l.status));
  const pendingQuotes = quotes.filter((q) => q.status === "Sent" || q.status === "Draft");
  const pendingValue = pendingQuotes.reduce((s, q) => s + itemsTotal(q.items), 0);
  const unpaidInvoices = invoices.filter((i) => i.status !== "Paid");
  const unpaidValue = unpaidInvoices.reduce((s, i) => s + itemsTotal(i.items), 0);
  const overdue = invoices.filter((i) => i.status === "Unpaid" && i.dueDate && i.dueDate < today());
  const lowStock = materials.filter((m) => Number(m.reorderLevel) > 0 && Number(m.qtyOnHand) <= Number(m.reorderLevel));
  const upcomingJobs = quotes
    .filter((q) => q.status === "Accepted" && q.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const acceptedNoDate = quotes.filter((q) => q.status === "Accepted" && !q.startDate);
  const daysSince = (dateStr) => {
    if (!dateStr) return 0;
    const then = new Date(dateStr + "T00:00:00");
    return Math.floor((new Date().setHours(0, 0, 0, 0) - then.setHours(0, 0, 0, 0)) / 86400000);
  };
  const needsFollowUp = quotes
    .filter((q) => q.status === "Sent" && daysSince(q.date) >= 3)
    .sort((a, b) => daysSince(b.date) - daysSince(a.date));

  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthIncome = invoices
    .filter((i) => i.status === "Paid" && (i.paidDate || i.issuedDate || "").slice(0, 7) === thisMonth)
    .reduce((s, i) => s + itemsTotal(i.items), 0);
  const monthExpense = expenses
    .filter((e) => (e.date || "").slice(0, 7) === thisMonth)
    .reduce((s, e) => s + Number(e.amount || 0), 0);

  const cards = [
    { label: "Active leads", value: activeLeads.length, sub: `${leads.length} total`, icon: Users, tab: "leads" },
    { label: "Quotes pending", value: pendingQuotes.length, sub: money(pendingValue), icon: FileText, tab: "quotes" },
    { label: "Unpaid invoices", value: unpaidInvoices.length, sub: money(unpaidValue), icon: Receipt, tab: "invoices", warn: overdue.length > 0 },
    { label: "Materials", value: materials.length, sub: materials.length === 1 ? "priced item" : "priced items", icon: Boxes, tab: "materials" },
  ];

  return (
    <div>
      <div className="section-head">
        <h1>Job board</h1>
        <p>Everything moving through Lyons Fencing & Services right now.</p>
      </div>

      <div className="card-grid">
        {cards.map((c) => (
          <button key={c.label} className={`stat-card${c.warn ? " warn" : ""}`} onClick={() => go(c.tab)}>
            <c.icon size={20} />
            <div className="stat-value">{c.value}</div>
            <div className="stat-label">{c.label}</div>
            <div className="stat-sub">{c.sub}</div>
          </button>
        ))}
      </div>

      {needsFollowUp.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <Phone size={16} />
            <span>Worth a follow-up</span>
          </div>
          <p className="calc-note" style={{ marginBottom: 10 }}>Sent, no response yet — the message's drafted, just tap to open it in Messages and send if it still looks right.</p>
          {needsFollowUp.map((q) => {
            const body = `Hi ${q.clientName}, just following up on the fencing quote (${q.docNumber}) I sent through ${daysSince(q.date)} days ago — let me know if you had any questions or want to go ahead. Cheers, Artie.`;
            return (
              <div key={q.id} className="upcoming-row">
                <div className="upcoming-date">{daysSince(q.date)}d</div>
                <div style={{ flex: 1 }}>
                  <div className="upcoming-name">{q.clientName}</div>
                  <div className="upcoming-sub">{q.jobType} · {money(gstBreakdown(itemsTotal(q.items)).total)} inc. GST</div>
                </div>
                {q.clientPhone ? (
                  <a className="btn-ghost small" href={`sms:${q.clientPhone}?body=${encodeURIComponent(body)}`}>Draft text</a>
                ) : (
                  <span className="calc-note" style={{ marginTop: 0 }}>Add phone</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(upcomingJobs.length > 0 || acceptedNoDate.length > 0) && (
        <div className="panel">
          <div className="panel-head">
            <CalendarDays size={16} />
            <span>Upcoming jobs</span>
          </div>
          {upcomingJobs.map((q) => (
            <div key={q.id} className="upcoming-row" onClick={() => go("quotes")}>
              <div className="upcoming-date">{formatDateAU(q.startDate)}</div>
              <div>
                <div className="upcoming-name">{q.clientName}</div>
                <div className="upcoming-sub">{q.jobType} {q.suburb ? `· ${q.suburb}` : ""} · {money(gstBreakdown(itemsTotal(q.items)).total)} inc. GST</div>
              </div>
            </div>
          ))}
          {acceptedNoDate.length > 0 && (
            <p className="calc-note" style={{ marginTop: upcomingJobs.length ? 10 : 0 }}>
              {acceptedNoDate.length} more accepted with no start date yet ({acceptedNoDate.map((q) => q.clientName).join(", ")}) — set one on the quote when you know it.
            </p>
          )}
        </div>
      )}

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

      {overdue.length > 0 && (
        <div className="alert-strip" onClick={() => go("invoices")}>
          <AlertTriangle size={16} />
          <span>{overdue.length} invoice{overdue.length > 1 ? "s" : ""} overdue — tap to review</span>
          <ChevronRight size={16} />
        </div>
      )}
      {lowStock.length > 0 && (
        <div className="alert-strip" onClick={() => go("materials")}>
          <Boxes size={16} />
          <span>{lowStock.length} material{lowStock.length > 1 ? "s" : ""} at or below reorder level</span>
          <ChevronRight size={16} />
        </div>
      )}
    </div>
  );
}

// ---------- Leads ----------
function Leads({ leads, setLeads, go }) {
  const [modal, setModal] = useState(null); // {mode:'new'|'edit', data}

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

      {leads.length === 0 ? (
        <EmptyState icon={Users} title="No leads yet" hint="Add an enquiry as soon as it comes in — by phone, form, or a mate's referral." onAdd={() => setModal({ mode: "new" })} addLabel="Add lead" />
      ) : (
        <div className="list">
          {leads.map((l) => (
            <div className="row-card" key={l.id} onClick={() => setModal({ mode: "edit", data: l })}>
              <div className="row-card-main">
                <div className="row-card-title">{l.name}</div>
                <div className="row-card-meta">
                  {l.jobType} {l.address ? `· ${l.address}` : ""}
                </div>
              </div>
              <Tag label={l.status} />
            </div>
          ))}
        </div>
      )}

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
      <Field label="Notes"><textarea rows={3} value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder="Site details, measurements, timing..." /></Field>

      <div className="modal-actions">
        {onDelete && <button className="btn-danger" onClick={onDelete}><Trash2 size={15} /> Delete</button>}
        {onQuote && <button className="btn-ghost" onClick={onQuote}><FileText size={15} /> Start quote</button>}
        <button className="btn-primary" onClick={() => onSave(form)} disabled={!form.name}><Check size={15} /> Save</button>
      </div>
    </Modal>
  );
}

// ---------- Line items editor (shared by Quotes & Invoices) ----------
function LineItems({ items, setItems, defaultLength, fenceHeight }) {
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
      setItems((its) => [...its, { id: uid(), desc, qty, rate, unit: t.unit }]);
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

function MaterialCalcModal({ onClose, onApply, materials, prefill }) {
  const [form, setForm] = useState({
    style: prefill?.style || "timber",
    timberStyle: prefill?.timberStyle || "butted",
    length: prefill?.length_m ?? "",
    height: prefill?.height_m ?? "1.8",
    gates: prefill?.gates ?? "0",
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
          </select>
        </Field>
        <Field label="Length (m)"><input type="number" value={form.length} onChange={(e) => set("length", e.target.value)} placeholder="e.g. 24" /></Field>
      </div>
      {form.style === "timber" && (
        <Field label="Timber style">
          <select value={form.timberStyle} onChange={(e) => set("timberStyle", e.target.value)}>
            <option value="butted">Butted paling</option>
            <option value="lapped">Lapped & capped (good neighbour)</option>
          </select>
        </Field>
      )}
      <div className="field-pair">
        <Field label="Height (m)"><input type="number" step="0.1" value={form.height} onChange={(e) => set("height", e.target.value)} /></Field>
        <Field label="Gates"><input type="number" value={form.gates} onChange={(e) => set("gates", e.target.value)} /></Field>
      </div>
      <div className="field-pair">
        <Field label="Bay width (m)"><input type="number" step="0.01" value={form.panelWidth} onChange={(e) => set("panelWidth", e.target.value)} placeholder={form.style === "colorbond" ? "2.365" : "2.4"} /></Field>
        <Field label="Post spacing (m)"><input type="number" step="0.01" value={form.postSpacing} onChange={(e) => set("postSpacing", e.target.value)} placeholder="same as bay width" /></Field>
      </div>
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
        <button className="btn-primary" disabled={!form.length} onClick={() => onApply(total)}>
          <Plus size={15} /> Add to your costs
        </button>
      </div>
    </Modal>
  );
}

// ---------- Quotes ----------
function Quotes({ quotes, setQuotes, invoices, setInvoices, pendingNewFrom, clearPending, settings, materials, bumpDocNumber }) {
  const [modal, setModal] = useState(null);
  const [quickScanning, setQuickScanning] = useState(false);
  const [quickScanError, setQuickScanError] = useState("");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [finalInvoiceQuote, setFinalInvoiceQuote] = useState(null);
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
      setModal({
        mode: "new",
        data: { clientName: pendingNewFrom.name, address: pendingNewFrom.address, jobType: pendingNewFrom.jobType, docNumber: previewNumber(), items: [] },
      });
      clearPending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNewFrom]);

  const save = (data) => {
    if (data.id) setQuotes((qs) => qs.map((q) => (q.id === data.id ? data : q)));
    else {
      bumpDocNumber();
      setQuotes((qs) => [{ ...data, id: uid(), date: today() }, ...qs]);
    }
    setModal(null);
  };
  const remove = (id) => setQuotes((qs) => qs.filter((q) => q.id !== id));

  const openFinalInvoice = (q) => {
    setModal(null);
    setFinalInvoiceQuote(q);
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
  const createDepositInvoice = (q) => {
    const docNumber = previewNumber();
    bumpDocNumber();
    const depositPct = Number(q.depositPercent) || 10;
    const exGstAmount = itemsTotal(q.items) * (depositPct / 100);
    const inv = {
      id: uid(),
      docNumber,
      clientName: q.clientName,
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
      dueDate: "",
      notes: `Balance due within 14 days of completion, per quote ${q.docNumber || ""}.`,
      quoteId: q.id,
    };
    setInvoices((is) => [inv, ...is]);
    setModal(null);
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

      {quotes.length === 0 ? (
        <EmptyState icon={FileText} title="No quotes yet" hint="Build a quote once you know the scope of a job." onAdd={() => setModal({ mode: "new", data: { items: [], docNumber: previewNumber() } })} addLabel="Add quote" />
      ) : (
        <div className="list">
          {quotes.map((q) => (
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
          initial={modal.data}
          settings={settings}
          materials={materials}
          onClose={() => setModal(null)}
          onSave={save}
          onDelete={modal.data?.id ? () => { remove(modal.data.id); setModal(null); } : null}
          onFinalInvoice={modal.data?.id ? () => openFinalInvoice(modal.data) : null}
          onCreateDeposit={modal.data?.id && modal.data.status === "Accepted" ? () => createDepositInvoice(modal.data) : null}
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

function QuoteModal({ initial, settings, materials, onClose, onSave, onDelete, onFinalInvoice, onCreateDeposit }) {
  const [form, setForm] = useState({ clientName: "", clientPhone: "", address: "", suburb: "", jobType: JOB_TYPES[0], status: "Draft", items: [], jobLength: "", fenceHeight: "1.8", distanceKm: "", crew: "1", hours: "", removalLength: "", materialsCost: 0, docNumber: "", depositPercent: "10", notes: "", startDate: "", ...initial });
  const [showCalc, setShowCalc] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [scanPrefill, setScanPrefill] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [estimatingRoute, setEstimatingRoute] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [lookingUpSuburb, setLookingUpSuburb] = useState(false);
  const [suburbError, setSuburbError] = useState("");
  const fileInputRef = useRef(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItems = (updater) => setForm((f) => ({ ...f, items: typeof updater === "function" ? updater(f.items) : updater }));

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
  const hourlyRate = Number(settings?.hourlyRate) || 65;
  const labourCost = (Number(form.crew) || 0) * (Number(form.hours) || 0) * hourlyRate;
  const tipRatePerMetre = Number(settings?.tipRatePerMetre) || 10;
  const tipCost = (Number(form.removalLength) || 0) * tipRatePerMetre;
  const materialsCost = Number(form.materialsCost) || 0;
  const runningCosts = fuelCost + labourCost + tipCost + materialsCost;
  const quoteTotal = itemsTotal(form.items);
  const addNote = (snippet) => set("notes", form.notes ? `${form.notes}\n${snippet}` : snippet);

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
      <Field label="Client phone (for follow-up texts)"><input type="tel" value={form.clientPhone || ""} onChange={(e) => set("clientPhone", e.target.value)} placeholder="04xx xxx xxx" /></Field>
      <div className="field-pair">
        <Field label="Job type">
          <select value={form.jobType} onChange={(e) => set("jobType", e.target.value)}>
            {JOB_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {QUOTE_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      {form.status === "Accepted" && (
        <Field label="Job start date"><input type="date" value={form.startDate || ""} onChange={(e) => set("startDate", e.target.value)} /></Field>
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
        <Field label="Job length (m)"><input type="number" value={form.jobLength || ""} onChange={(e) => set("jobLength", e.target.value)} placeholder="e.g. 25" /></Field>
        <Field label="Fence height (m)"><input type="number" step="0.1" value={form.fenceHeight || ""} onChange={(e) => set("fenceHeight", e.target.value)} placeholder="e.g. 1.8" /></Field>
      </div>
      <Field label="Deposit (%)"><input type="number" value={form.depositPercent || ""} onChange={(e) => set("depositPercent", e.target.value)} style={{ maxWidth: 100 }} /></Field>

      <Field label="Line items">
        <p className="calc-note">This is what the client sees and pays — "Insert job template" below uses your job length and fence height automatically.</p>
        <LineItems items={form.items} setItems={setItems} defaultLength={form.jobLength} fenceHeight={form.fenceHeight} />
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
        {materialsCost > 0 && (
          <div className="fuel-note">
            <Boxes size={14} /> {money(materialsCost)} in materials added
            <button type="button" className="btn-ghost small" onClick={() => set("materialsCost", 0)}>Clear</button>
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
          <Field label="Crew size"><input type="number" value={form.crew || ""} onChange={(e) => set("crew", e.target.value)} /></Field>
          <Field label="Hours on site"><input type="number" value={form.hours || ""} onChange={(e) => set("hours", e.target.value)} placeholder="e.g. 8" /></Field>
        </div>
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
            <div className="job-cost-total"><span>Quote total (what you're charging)</span><span>{money(quoteTotal)}</span></div>
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
          onClose={() => { setShowCalc(false); setScanPrefill(null); }}
          onApply={(total) => {
            set("materialsCost", materialsCost + total);
            setShowCalc(false);
            setScanPrefill(null);
          }}
        />
      )}

      <div className="modal-actions">
        {onDelete && <button className="btn-danger" onClick={onDelete}><Trash2 size={15} /> Delete</button>}
        {onFinalInvoice && <button className="btn-ghost" onClick={onFinalInvoice}><Receipt size={15} /> Create final invoice</button>}
        {onCreateDeposit && <button className="btn-ghost" onClick={onCreateDeposit}><Receipt size={15} /> Create deposit invoice</button>}
        <button className="btn-ghost" onClick={() => setShowPreview(true)}><FileText size={15} /> Preview & PDF</button>
        <button className="btn-primary" onClick={() => onSave(form)} disabled={!form.clientName}><Check size={15} /> Save</button>
      </div>

      {showPreview && <DocumentPreviewModal type="quote" data={form} onClose={() => setShowPreview(false)} />}
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

      {invoices.length === 0 ? (
        <EmptyState icon={Receipt} title="No invoices yet" hint="Raise one directly, or convert an accepted quote from the Quotes tab." onAdd={() => setModal({ mode: "new", data: { items: [], status: "Unpaid", docNumber: previewNumber() } })} addLabel="Add invoice" />
      ) : (
        <div className="list">
          {invoices.map((i) => (
            <div className="row-card" key={i.id} onClick={() => setModal({ mode: "edit", data: i })}>
              <div className="row-card-main">
                <div className="row-card-title">{i.clientName || "Untitled"}</div>
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
    <Modal title={initial?.id ? "Edit invoice" : "New invoice"} onClose={onClose}>
      <div className="field-pair">
        <Field label="Client"><input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} placeholder="Client name" /></Field>
        <Field label="Invoice #"><input value={form.docNumber || ""} onChange={(e) => set("docNumber", e.target.value)} /></Field>
      </div>
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
        <button className="btn-primary" onClick={() => onSave(form)} disabled={!form.clientName}><Check size={15} /> Save</button>
      </div>

      {showPreview && <DocumentPreviewModal type="invoice" data={form} onClose={() => setShowPreview(false)} />}
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
  const totalIncome = paidInvoices.reduce((s, i) => s + itemsTotal(i.items), 0);
  const totalExpense = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const actualFuelSpend = expenses.filter((e) => e.category === "Fuel").reduce((s, e) => s + Number(e.amount || 0), 0);
  const estimatedFuelAcrossQuotes = (quotes || []).reduce((s, q) => s + estFuelCost(q.distanceKm, settings), 0);

  const byMonth = useMemo(() => {
    const map = {};
    paidInvoices.forEach((i) => {
      const m = (i.paidDate || i.issuedDate || "").slice(0, 7);
      if (!m) return;
      map[m] = map[m] || { income: 0, expense: 0 };
      map[m].income += itemsTotal(i.items);
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
          <div className="stat-label">Total income (paid)</div>
        </div>
        <div className="stat-card static">
          <TrendingDown size={20} />
          <div className="stat-value bad">{money(totalExpense)}</div>
          <div className="stat-label">Total expenses</div>
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

  return (
    <Modal title={initial?.id ? "Edit expense" : "Log expense"} onClose={onClose}>
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

function SettingsModal({ settings, onSave, onClose }) {
  const [form, setForm] = useState({ consumption: 10.5, fuelPrice: 1.85, hourlyRate: 65, tipRatePerMetre: 10, ...settings });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal title="Job cost defaults" onClose={onClose}>
      <p className="calc-note">Used to estimate fuel, labour and tipping cost per job on quotes. Defaults are a rough starting point — adjust to what you're actually seeing.</p>
      <div className="field-pair">
        <Field label="Consumption (L/100km)"><input type="number" step="0.1" value={form.consumption ?? ""} onChange={(e) => set("consumption", e.target.value)} /></Field>
        <Field label="Diesel price ($/L)"><input type="number" step="0.01" value={form.fuelPrice ?? ""} onChange={(e) => set("fuelPrice", e.target.value)} /></Field>
      </div>
      <Field label="Labour rate ($/hr per crew member)"><input type="number" step="1" value={form.hourlyRate ?? ""} onChange={(e) => set("hourlyRate", e.target.value)} /></Field>
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

// ---------- App shell ----------
const TABS = [
  { key: "dashboard", label: "Board", icon: LayoutGrid },
  { key: "leads", label: "Leads", icon: Users },
  { key: "clients", label: "Clients", icon: UserCircle },
  { key: "quotes", label: "Quotes", icon: FileText },
  { key: "invoices", label: "Invoices", icon: Receipt },
  { key: "materials", label: "Materials", icon: Boxes },
  { key: "finances", label: "Finances", icon: Wallet },
];

export default function HubApp() {
  const [tab, setTab] = useState("dashboard");
  const [pendingNewFrom, setPendingNewFrom] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [leads, setLeads, leadsLoaded] = usePersistedList("lyons:leads");
  const [quotes, setQuotes, quotesLoaded] = usePersistedList("lyons:quotes");
  const [invoices, setInvoices, invoicesLoaded] = usePersistedList("lyons:invoices");
  const [materials, setMaterials, materialsLoaded] = usePersistedList("lyons:materials");
  const [expenses, setExpenses, expensesLoaded] = usePersistedList("lyons:expenses");
  const [settings, setSettings, settingsLoaded] = usePersistedValue("lyons:settings", { consumption: 10.5, fuelPrice: 1.85, hourlyRate: 65, tipRatePerMetre: 10, nextDocNumber: 458 });

  const allLoaded = leadsLoaded && quotesLoaded && invoicesLoaded && materialsLoaded && expensesLoaded && settingsLoaded;

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
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">LF</div>
          <div>
            <div className="brand-name">Lyons Fencing & Services</div>
            <div className="brand-sub">Business hub</div>
          </div>
        </div>
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
            {tab === "dashboard" && <Dashboard leads={leads} quotes={quotes} invoices={invoices} materials={materials} expenses={expenses} go={go} />}
            {tab === "leads" && <Leads leads={leads} setLeads={setLeads} go={go} />}
            {tab === "clients" && <Clients leads={leads} quotes={quotes} invoices={invoices} go={go} />}
            {tab === "quotes" && <Quotes quotes={quotes} setQuotes={setQuotes} invoices={invoices} setInvoices={setInvoices} pendingNewFrom={pendingNewFrom} clearPending={() => setPendingNewFrom(null)} settings={settings} materials={materials} bumpDocNumber={bumpDocNumber} />}
            {tab === "invoices" && <Invoices invoices={invoices} setInvoices={setInvoices} settings={settings} bumpDocNumber={bumpDocNumber} />}
            {tab === "materials" && <Materials materials={materials} setMaterials={setMaterials} />}
            {tab === "finances" && <Finances invoices={invoices} expenses={expenses} setExpenses={setExpenses} quotes={quotes} settings={settings} />}
          </>
        )}
      </main>

      {settingsOpen && <SettingsModal settings={settings} onSave={(s) => { setSettings(s); setSettingsOpen(false); }} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
