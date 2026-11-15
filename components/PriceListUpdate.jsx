"use client";
// "Update prices from a price list" on the Materials tab: add a supplier price list (PDF, photo or screenshot), Claude copies the lines out, and each
// is matched to a material you already have (you can change which, or add it as new). Tick the ones to apply: only those prices change.
import { useMemo, useState } from "react";
import { X, Check, Upload } from "lucide-react";
import { money, uid } from "@/lib/logic";
import { matchPriceList } from "@/lib/priceList";

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = () => reject(new Error("Couldn't read that file."));
  r.readAsDataURL(file);
});
function shrink(file, max = 1800) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ base64: c.toDataURL("image/jpeg", 0.85).split(",")[1], mediaType: "image/jpeg" });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't open that image.")); };
    img.src = url;
  });
}

export default function PriceListUpdate({ materials = [], setMaterials, onClose }) {
  const [read, setRead] = useState(null); // { supplier, priceBasis, items }
  const [exGst, setExGst] = useState(false);
  const [choice, setChoice] = useState({}); // row index -> material id | "new" | "skip"
  const [on, setOn] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  const rows = useMemo(() => (read ? matchPriceList(read.items, materials, { exGst }) : []), [read, materials, exGst]);
  const matById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  const load = async (files) => {
    setBusy(true); setError(""); setDone(null);
    try {
      const out = [];
      for (const f of Array.from(files || []).slice(0, 4)) {
        if (f.type === "application/pdf") {
          if (f.size > 3.2 * 1024 * 1024) throw new Error("That PDF is too big (over 3MB). Send fewer pages, or a screenshot of the part you need.");
          out.push({ base64: await fileToBase64(f), mediaType: "application/pdf" });
        } else out.push(await shrink(f));
      }
      const res = await fetch("/api/ai/read-pricelist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: out }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't read that price list.");
      if (!body.items?.length) throw new Error("I couldn't find any priced lines in that.");
      setRead(body);
      setExGst(body.priceBasis === "ex GST");
      const m = matchPriceList(body.items, materials, { exGst: body.priceBasis === "ex GST" });
      setChoice(Object.fromEntries(m.map((r, i) => [i, r.material ? r.material.id : "skip"])));
      setOn(Object.fromEntries(m.map((r, i) => [i, !!r.material && r.changePct !== 0])));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const view = rows.map((r, i) => {
    const c = choice[i] ?? "skip";
    const mat = c !== "skip" && c !== "new" ? matById.get(c) : null;
    const oldPrice = mat ? Number(mat.costPerUnit) || 0 : null;
    return { ...r, i, c, mat, oldPrice, changePct: mat && oldPrice > 0 ? Math.round(((r.newPrice - oldPrice) / oldPrice) * 1000) / 10 : null };
  });
  const chosen = view.filter((v) => on[v.i] && v.c !== "skip");

  const apply = () => {
    const updates = new Map(chosen.filter((v) => v.mat).map((v) => [v.mat.id, v.newPrice]));
    const added = chosen.filter((v) => v.c === "new").map((v) => ({ id: uid(), name: v.item.name, unit: v.item.unit || "each", costPerUnit: v.newPrice, packQty: 1, qtyOnHand: 0, reorderLevel: 0, supplier: read.supplier || "" }));
    setMaterials((rowsNow) => [...added, ...rowsNow.map((m) => (updates.has(m.id) ? { ...m, costPerUnit: updates.get(m.id) } : m))]);
    setDone({ updated: updates.size, added: added.length });
    setRead(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>Update prices from a price list</span><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">
          {done && <p className="calc-note" style={{ color: "var(--good)" }}><Check size={13} style={{ verticalAlign: "-2px" }} /> Updated {done.updated} {done.updated === 1 ? "price" : "prices"}{done.added ? ` and added ${done.added} new ${done.added === 1 ? "material" : "materials"}` : ""}.</p>}
          {!read && (
            <>
              <p className="calc-note" style={{ marginTop: 0 }}>Add a supplier price list: a PDF, a photo, or a screenshot. It's read by Claude, matched to your materials, and you choose which prices to change. Nothing changes until you press Apply.</p>
              <label className="btn-primary" style={{ cursor: "pointer", display: "inline-flex", gap: 6 }}>
                <Upload size={15} /> {busy ? "Reading… (can take a minute)" : "Add a price list"}
                <input type="file" multiple accept="application/pdf,image/*" hidden disabled={busy} onChange={(e) => { load(e.target.files); e.target.value = ""; }} />
              </label>
              {error && <p className="calc-note" style={{ color: "var(--bad)" }}>{error}</p>}
            </>
          )}
          {read && (
            <>
              <p className="calc-note" style={{ marginTop: 0 }}>{read.supplier ? `${read.supplier}: ` : ""}{read.items.length} lines read. The list says its prices are <strong>{read.priceBasis === "unknown" ? "not stated as ex or inc GST" : read.priceBasis}</strong>.</p>
              <label className="check-row"><input type="checkbox" checked={exGst} onChange={(e) => setExGst(e.target.checked)} /> These prices are ex GST (add 10%, since your materials are kept inc GST)</label>
              {view.map((v) => (
                <div key={v.i} style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                  <label className="check-row" style={{ alignItems: "flex-start" }}>
                    <input type="checkbox" checked={!!on[v.i] && v.c !== "skip"} disabled={v.c === "skip"} onChange={(e) => setOn((o) => ({ ...o, [v.i]: e.target.checked }))} />
                    <span style={{ fontSize: 14 }}>
                      {v.item.name}
                      <span className="calc-note" style={{ display: "block", margin: 0 }}>
                        {v.c === "skip" ? `${money(v.newPrice)} · no match` : v.c === "new" ? `${money(v.newPrice)} · will be added as a new material` : <>{money(v.oldPrice)} → <strong>{money(v.newPrice)}</strong>{v.changePct != null && <span style={{ color: Math.abs(v.changePct) >= 10 ? "var(--warn, #c9873a)" : undefined }}> ({v.changePct > 0 ? "+" : ""}{v.changePct}%)</span>}</>}
                      </span>
                    </span>
                  </label>
                  <select value={v.c} onChange={(e) => { setChoice((c) => ({ ...c, [v.i]: e.target.value })); setOn((o) => ({ ...o, [v.i]: e.target.value !== "skip" })); }} style={{ marginLeft: 26, maxWidth: "calc(100% - 26px)", fontSize: 12.5 }}>
                    <option value="skip">Skip this line</option>
                    <option value="new">Add as a new material</option>
                    {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="modal-actions">
          {read && <button className="btn-ghost" onClick={() => setRead(null)}>Start again</button>}
          {read && <button className="btn-primary" disabled={chosen.length === 0} onClick={apply}><Check size={15} /> Apply {chosen.length}</button>}
          {!read && <button className="btn-ghost" onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  );
}
