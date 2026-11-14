"use client";
// The Assistant tab: ask the hub a question (typed or spoken), size up a job from photos, write a reply to a client's email, and write a
// reply to a Google review. The thinking happens in server routes (app/api/ask, app/api/ai/*) so the Anthropic key never reaches the phone.
import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Send, Camera, Mail, Star, Copy, Check, Volume2, VolumeX, X, Trash2, Sparkles } from "lucide-react";
import { money, itemsTotal, gstBreakdown } from "@/lib/logic";
import { canListen, canSpeak, listen, speak, stopSpeaking, unlockSpeech, onVoicesReady, pickVoice, chooseVoice } from "@/lib/voice";
import { clientOptions, searchClients } from "@/lib/clientPick";
import { quotesForLead } from "@/lib/quoteDecision";

const incTotal = (items) => gstBreakdown(itemsTotal(items)).total;
const post = async (path, body) => {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `That didn't work (${res.status}).`);
  return data;
};
const copyText = async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };

function CopyBtn({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="btn-ghost small" onClick={async () => { if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 2000); } }}>{done ? <><Check size={13} /> Copied</> : <><Copy size={13} /> {label}</>}</button>;
}

// ---------------- Ask the hub ----------------
const IDEAS = ["How much have I made this month?", "Who still owes me money?", "Which quotes haven't been answered?", "How many leads came in this week?"];

function Ask() {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  const [voiceUri, setVoiceUri] = useState("");
  const [listening, setListening] = useState(false);
  const [reads, setReads] = useState(true); // answers are spoken back (on unless you turn it off)
  const [mic, setMic] = useState(false);
  const rec = useRef(null);
  const endRef = useRef(null);
  useEffect(() => {
    setMic(canListen());
    try { setReads(window.localStorage.getItem("lyons:ask-speak") !== "off"); } catch {}
    return onVoicesReady((list) => { setVoices(list); setVoiceUri(pickVoice()?.voiceURI || ""); });
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [msgs, busy]);
  useEffect(() => () => { rec.current?.stop(); stopSpeaking(); }, []);

  const ask = async (q) => {
    const question = String(q || "").trim();
    if (!question || busy) return;
    stopSpeaking();
    setSpeaking(false);
    if (reads) unlockSpeech(); // the phone only lets the page talk after a tap, so this happens inside the tap that sends the question
    setError("");
    setInput("");
    const history = msgs;
    setMsgs((m) => [...m, { role: "user", content: question }]);
    setBusy(true);
    try {
      const { answer } = await post("/api/ask", { question, history });
      setMsgs((m) => [...m, { role: "assistant", content: answer }]);
      if (reads && canSpeak()) speak(answer, { onStart: () => setSpeaking(true), onDone: () => setSpeaking(false) });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = () => {
    if (listening) { rec.current?.stop(); return; }
    stopSpeaking();
    setSpeaking(false);
    if (reads) unlockSpeech();
    setError("");
    setListening(true);
    let last = "";
    rec.current = listen({
      onText: (t, final) => { last = t; setInput(t); if (final) { rec.current?.stop(); } },
      onEnd: () => { setListening(false); if (last) ask(last); },
      onError: (code) => {
        setListening(false);
        setError(code === "not-allowed" || code === "service-not-allowed" ? "The microphone is blocked for this page. Allow it in your phone's settings, or use the microphone key on your keyboard instead." : code === "no-speech" ? "I didn't hear anything. Tap the mic and try again." : "Listening didn't work here. Use the microphone key on your keyboard instead.");
      },
    });
  };
  const toggleReads = () => { const n = !reads; setReads(n); if (!n) { stopSpeaking(); setSpeaking(false); } try { window.localStorage.setItem("lyons:ask-speak", n ? "on" : "off"); } catch {} };

  return (
    <div>
      <p className="calc-note" style={{ marginTop: 0 }}>Ask about your money, quotes, invoices, leads or jobs. It answers from what's in the hub right now. Phone numbers and emails aren't shared with it.</p>
      {msgs.length === 0 && (
        <div className="calc-trigger-row" style={{ marginBottom: 10 }}>
          {IDEAS.map((t) => <button key={t} type="button" className="btn-ghost small" onClick={() => ask(t)}>{t}</button>)}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "92%", background: m.role === "user" ? "var(--hivis)" : "var(--panel-2, rgba(255,255,255,0.06))", color: m.role === "user" ? "#1C1F1D" : "inherit", borderRadius: 12, padding: "8px 12px", whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.45 }}>{m.content}</div>
        ))}
        {busy && <div className="calc-note" style={{ margin: 0 }}>Thinking…</div>}
        <div ref={endRef} />
      </div>
      {error && <p className="calc-note" style={{ color: "var(--bad)" }}>{error}</p>}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
        <textarea className="li-desc" rows={2} style={{ flex: 1, minWidth: 0 }} placeholder={listening ? "Listening…" : "Ask a question…"} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }} />
        {mic && <button type="button" className={listening ? "btn-primary" : "btn-ghost"} onClick={toggleMic} aria-label={listening ? "Stop listening" : "Ask by voice"} title="Ask by voice">{listening ? <MicOff size={18} /> : <Mic size={18} />}</button>}
        <button type="button" className="btn-primary" disabled={busy || !input.trim()} onClick={() => ask(input)} aria-label="Send"><Send size={16} /></button>
      </div>
      <div className="calc-trigger-row" style={{ marginTop: 8, alignItems: "center" }}>
        {canSpeak() && <button type="button" className="link-btn" onClick={toggleReads}>{reads ? <><Volume2 size={12} /> Voice replies on</> : <><VolumeX size={12} /> Voice replies off</>}</button>}
        {speaking && <button type="button" className="btn-ghost small" onClick={() => { stopSpeaking(); setSpeaking(false); }}><VolumeX size={13} /> Stop talking</button>}
        {msgs.length > 0 && <button type="button" className="link-btn" onClick={() => { stopSpeaking(); setSpeaking(false); setMsgs([]); setError(""); }}><Trash2 size={12} /> Clear</button>}
      </div>
      {canSpeak() && reads && (
        <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
          <span>Voice</span>
          <div style={{ display: "flex", gap: 6 }}>
            <select value={voiceUri} onChange={(e) => { setVoiceUri(e.target.value); chooseVoice(e.target.value); }} style={{ flex: 1, minWidth: 0 }}>
              {voices.length === 0 && <option value="">Phone's default voice</option>}
              {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang.replace("_", "-")})</option>)}
            </select>
            <button type="button" className="btn-ghost small" onClick={() => { unlockSpeech(); speak("G'day Artie. This is how I'll sound. Your next job starts on Monday.", { onStart: () => setSpeaking(true), onDone: () => setSpeaking(false) }); }}>Hear it</button>
          </div>
          <span style={{ fontSize: 11.5 }}>For a more natural voice on iPhone: Settings, Accessibility, Spoken Content, Voices, English (Australia), then download an Enhanced or Premium one (Karen or Matilda). It shows up here.</span>
        </div>
      )}
      {!mic && <p className="calc-note">To talk instead of type: tap the box and use the microphone key on your keyboard, then press send.</p>}
      {mic && <p className="calc-note">If the mic button doesn't work from your Home Screen icon, open the hub in Safari, or use the microphone key on your keyboard.</p>}
    </div>
  );
}

// ---------------- Photo estimate ----------------
// photos are shrunk before sending: a phone photo can be 5MB+, and the server only takes about 4MB per request
function shrink(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL("image/jpeg", 0.8);
      resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg", preview: dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't open that photo (HEIC photos from some phones need to be shared as JPEG).")); };
    img.src = url;
  });
}

function Photo({ leads, setLeads }) {
  const [pics, setPics] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [res, setRes] = useState(null);
  const [leadId, setLeadId] = useState("");
  const [added, setAdded] = useState(false);

  const add = async (files) => {
    setError("");
    try {
      const made = [];
      for (const f of Array.from(files || []).slice(0, 5 - pics.length)) made.push(await shrink(f));
      setPics((p) => [...p, ...made].slice(0, 5));
    } catch (e) { setError(e.message); }
  };
  const run = async () => {
    setBusy(true); setError(""); setRes(null); setAdded(false);
    try { setRes((await post("/api/ai/site-photo", { images: pics.map(({ base64, mediaType }) => ({ base64, mediaType })), note })).result); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const addToLead = () => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || !res?.siteNotes) return;
    const line = `Photo estimate (check on site): ${String(res.siteNotes).replace(/\s*\n\s*/g, "; ")}`;
    setLeads((rows) => rows.map((l) => (l.id === leadId ? { ...l, notes: [l.notes, line].filter(Boolean).join("\n\n") } : l)));
    setAdded(true);
  };
  const len = res?.lengthM;
  const lenText = len && (len.low != null || len.high != null) ? (len.low === len.high || len.high == null ? `about ${len.low}m` : `${len.low ?? "?"} to ${len.high ?? "?"}m`) : "can't tell";

  return (
    <div>
      <p className="calc-note" style={{ marginTop: 0 }}>Add photos of the fence line or where the new one goes (up to 5). It gives a rough read before you visit. It's an estimate from pictures, so check the numbers on site.</p>
      <div className="calc-trigger-row" style={{ marginBottom: 8 }}>
        <label className="btn-ghost small" style={{ cursor: "pointer" }}><Camera size={13} /> Add photos<input type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} /></label>
        {pics.length > 0 && <button type="button" className="link-btn" onClick={() => { setPics([]); setRes(null); }}>Clear</button>}
      </div>
      {pics.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {pics.map((p, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img src={p.preview} alt="" style={{ width: 78, height: 78, objectFit: "cover", borderRadius: 8 }} />
              <button type="button" className="icon-btn" style={{ position: "absolute", top: -6, right: -6 }} onClick={() => setPics((x) => x.filter((_, j) => j !== i))} aria-label="Remove photo"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <label className="field"><span>Anything you already know (optional)</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. rear boundary, client wants 1.8m timber, about 15m" /></label>
      <button type="button" className="btn-primary" disabled={!pics.length || busy} onClick={run}><Sparkles size={15} /> {busy ? "Looking…" : "Read the photos"}</button>
      {error && <p className="calc-note" style={{ color: "var(--bad)" }}>{error}</p>}
      {res && (
        <div className="calc-preview" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
          <div><strong>{res.jobType || "Unclear"}</strong>{res.heightM ? ` · about ${res.heightM}m high` : ""} · length {lenText} <span className="calc-note" style={{ margin: 0 }}>(confidence: {res.confidence || "low"})</span></div>
          {res.summary && <div>{res.summary}</div>}
          {res.lengthM?.basedOn && <div className="calc-note" style={{ margin: 0 }}>Length based on: {res.lengthM.basedOn}</div>}
          {res.existingFence && <div><span className="calc-note" style={{ margin: 0 }}>Existing:</span> {res.existingFence}</div>}
          {res.gates && <div><span className="calc-note" style={{ margin: 0 }}>Gates:</span> {res.gates}</div>}
          {res.removal != null && <div><span className="calc-note" style={{ margin: 0 }}>Removal of old fence:</span> {res.removal ? "likely" : "probably not"}</div>}
          {res.slopeOrRetaining && <div><span className="calc-note" style={{ margin: 0 }}>Slope:</span> {res.slopeOrRetaining}</div>}
          {res.access && <div><span className="calc-note" style={{ margin: 0 }}>Access:</span> {res.access}</div>}
          {res.confirmOnSite?.length > 0 && <div><strong style={{ fontSize: 13 }}>Check on site</strong><ul style={{ margin: "2px 0 0 18px", padding: 0 }}>{res.confirmOnSite.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
          {res.questionsForClient?.length > 0 && <div><strong style={{ fontSize: 13 }}>Ask the client</strong><ul style={{ margin: "2px 0 0 18px", padding: 0 }}>{res.questionsForClient.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
          {res.siteNotes && (
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <div className="calc-note" style={{ margin: "0 0 4px" }}>Notes you could use:</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{res.siteNotes}</div>
              <div className="calc-trigger-row" style={{ marginTop: 8, alignItems: "center" }}>
                <CopyBtn text={res.siteNotes} />
                <select className="li-desc" style={{ maxWidth: 190 }} value={leadId} onChange={(e) => { setLeadId(e.target.value); setAdded(false); }}>
                  <option value="">Add to a lead's notes…</option>
                  {leads.map((l) => <option key={l.id} value={l.id}>{l.name || "Lead"}{l.address ? ` · ${l.address}` : ""}</option>)}
                </select>
                <button type="button" className="btn-primary small" disabled={!leadId || added} onClick={addToLead}>{added ? <><Check size={13} /> Added</> : "Add"}</button>
              </div>
              <div className="calc-note" style={{ margin: "6px 0 0" }}>Added as "Photo estimate (check on site)" so it's clear it isn't a measurement. Change the numbers to the real ones before you quote.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- Reply to an email ----------------
function factsFor(person, quotes, invoices) {
  const f = person.fields;
  const mine = quotesForLead(quotes, { name: f.clientName, phone: f.clientPhone, email: f.clientEmail });
  const ids = new Set(mine.map((q) => q.id));
  const theirs = invoices.filter((i) => (i.quoteId && ids.has(i.quoteId)) || (f.clientEmail && String(i.clientEmail || "").toLowerCase() === f.clientEmail.toLowerCase()));
  const lines = [];
  if (f.address || f.suburb) lines.push(`Address: ${[f.address, f.suburb].filter(Boolean).join(", ")}`);
  for (const q of mine) lines.push(`Quote ${q.docNumber || ""} (${q.jobType || "fencing"}${q.title ? `, ${q.title}` : ""}): ${q.status}, sent ${String(q.date || "").slice(0, 10)}, ${money(incTotal(q.items))} inc GST${q.startDate ? `, starts ${q.startDate}` : ""}`);
  for (const i of theirs) lines.push(`Invoice ${i.docNumber || ""}: ${i.status}, ${money(incTotal(i.items))} inc GST${i.dueDate ? `, due ${i.dueDate}` : ""}`);
  return lines.join("\n") || "No quotes or invoices on file for them.";
}

function EmailReply({ leads, quotes, invoices }) {
  const options = useMemo(() => clientOptions({ leads, quotes, invoices }), [leads, quotes, invoices]);
  const [who, setWho] = useState(null);
  const [find, setFind] = useState("");
  const [message, setMessage] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [out, setOut] = useState(null);
  const hits = who ? [] : searchClients(options, find, 5);

  const run = async () => {
    setBusy(true); setError(""); setOut(null);
    try {
      const r = await post("/api/ai/draft-reply", { kind: "email", clientName: who?.name || "", facts: who ? factsFor(who, quotes, invoices) : "", message, instruction });
      setOut(r);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const mailto = out ? `mailto:${who?.fields.clientEmail || ""}?subject=${encodeURIComponent(out.subject || "")}&body=${encodeURIComponent(out.body || "")}` : "";

  return (
    <div>
      <p className="calc-note" style={{ marginTop: 0 }}>Paste an email you've been sent and get a reply written in your voice. Pick the client so it knows their quotes and invoices. Nothing is sent: you check it, then open it in your email app.</p>
      <div className="field">
        <span>Who is it from? (optional)</span>
        {who ? (
          <div className="calc-trigger-row" style={{ alignItems: "center" }}><strong style={{ fontSize: 14 }}>{who.name}</strong><span className="calc-note" style={{ margin: 0 }}>{who.sub}</span><button type="button" className="link-btn" onClick={() => { setWho(null); setFind(""); }}>Change</button></div>
        ) : (
          <>
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type a name or address" />
            {hits.map((h) => <button key={h.key} type="button" className="btn-ghost small" style={{ justifyContent: "flex-start", textAlign: "left", marginTop: 4 }} onClick={() => setWho(h)}>{h.name} <span className="calc-note" style={{ margin: "0 0 0 6px" }}>{h.sub}</span></button>)}
          </>
        )}
      </div>
      <label className="field"><span>Their email</span><textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Paste what they wrote" /></label>
      <label className="field"><span>What you want to say (optional)</span><input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. yes Thursday works, I'll be there about 8" /></label>
      <button type="button" className="btn-primary" disabled={busy || !message.trim()} onClick={run}><Mail size={15} /> {busy ? "Writing…" : "Write the reply"}</button>
      {error && <p className="calc-note" style={{ color: "var(--bad)" }}>{error}</p>}
      {out && (
        <div style={{ marginTop: 12 }}>
          {out.needs?.length > 0 && <p className="calc-note" style={{ color: "var(--warn, #c9873a)" }}>Fill in before sending: {out.needs.join(" · ")}</p>}
          <label className="field"><span>Subject</span><input value={out.subject} onChange={(e) => setOut({ ...out, subject: e.target.value })} /></label>
          <label className="field"><span>Reply (edit it if you like)</span><textarea rows={9} value={out.body} onChange={(e) => setOut({ ...out, body: e.target.value })} /></label>
          <div className="calc-trigger-row">
            <a className="btn-primary" href={mailto}><Mail size={15} /> Open in email</a>
            <CopyBtn text={out.body} label="Copy reply" />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Reply to a Google review ----------------
function ReviewReply() {
  const [stars, setStars] = useState(5);
  const [reviewer, setReviewer] = useState("");
  const [review, setReview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const run = async () => {
    setBusy(true); setError(""); setReply("");
    try { setReply((await post("/api/ai/draft-reply", { kind: "review", stars, reviewer, review })).reply); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div>
      <p className="calc-note" style={{ marginTop: 0 }}>Paste a Google review and get a reply ready to post. Once your Google business location is verified, paste it under the review there.</p>
      <div className="field">
        <span>Stars</span>
        <div style={{ display: "flex", gap: 4 }}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className="icon-btn" onClick={() => setStars(n)} aria-label={`${n} stars`}><Star size={22} fill={n <= stars ? "currentColor" : "none"} /></button>)}</div>
      </div>
      <label className="field"><span>Their name (optional)</span><input value={reviewer} onChange={(e) => setReviewer(e.target.value)} /></label>
      <label className="field"><span>The review</span><textarea rows={5} value={review} onChange={(e) => setReview(e.target.value)} placeholder="Paste what they wrote" /></label>
      <button type="button" className="btn-primary" disabled={busy || !review.trim()} onClick={run}><Star size={15} /> {busy ? "Writing…" : "Write a reply"}</button>
      {error && <p className="calc-note" style={{ color: "var(--bad)" }}>{error}</p>}
      {reply && (
        <div style={{ marginTop: 12 }}>
          <label className="field"><span>Reply (edit it if you like)</span><textarea rows={6} value={reply} onChange={(e) => setReply(e.target.value)} /></label>
          <CopyBtn text={reply} label="Copy reply" />
        </div>
      )}
    </div>
  );
}

// ---------------- the tab ----------------
const SECTIONS = [
  { key: "ask", label: "Ask the hub", icon: Mic },
  { key: "photo", label: "Photo estimate", icon: Camera },
  { key: "email", label: "Reply to email", icon: Mail },
  { key: "review", label: "Review reply", icon: Star },
];

export default function Assistant({ leads = [], quotes = [], invoices = [], setLeads }) {
  const [section, setSection] = useState("ask");
  return (
    <div>
      <div className="section-head row"><div><h1>Assistant</h1><p>Ask questions, size up a job from photos, and write replies for you to check.</p></div></div>
      <div className="calc-trigger-row" style={{ marginBottom: 14 }}>
        {SECTIONS.map((s) => <button key={s.key} type="button" className={section === s.key ? "btn-primary small" : "btn-ghost small"} onClick={() => setSection(s.key)}><s.icon size={13} /> {s.label}</button>)}
      </div>
      <div className="panel">
        {section === "ask" && <Ask />}
        {section === "photo" && <Photo leads={leads} setLeads={setLeads} />}
        {section === "email" && <EmailReply leads={leads} quotes={quotes} invoices={invoices} />}
        {section === "review" && <ReviewReply />}
      </div>
    </div>
  );
}
