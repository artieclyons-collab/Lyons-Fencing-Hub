// Brings leads in from the business Gmail inbox.
//   - hipages: when you accept a hipages lead, hipages emails the client's details here -> a new lead (source "hipages")
//   - direct enquiries: a person emailing you about a fence -> a new lead (source "email"); their replies later (address, "free from
//     3:30", a cancellation) update that lead the same way forwarded texts do
// Everything else in the inbox is ignored.
//   GET  -> is it set up?
//   POST -> look for new emails and act on them. Safe to call as often as you like.
// Read-only: the mailbox is opened read-only, so nothing is ever marked read, moved, labelled or deleted. Uses the same
// GMAIL_USER / GMAIL_APP_PASSWORD as the quote emails. Called by the hub while it's open, or by an outside timer with x-api-key.
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isJobDetails, parseJobDetails } from "@/lib/hipages";
import { headerMap, classify, isReply, leadFromEmail, applyClientMessage, matchLead, cleanBody, findPhone, nameKeys } from "@/lib/inboxLeads";
import { detectDecision, decideQuote, saveDecision } from "@/lib/quoteDecision";
import { renameClient } from "@/lib/leadName";
import { relevantParts } from "@/lib/relevant";
import { clientFromQuotes } from "@/lib/leadQuotes";
import { sendPush, nudgeUnanswered, dailyTextsDigest } from "@/lib/push";
import { foldUpdate } from "@/lib/noteSummary";
import { attachmentsOf, looksLikeSupplierMail, importSupplierMails } from "@/lib/supplierMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { headers: { "Cache-Control": "no-store" } };
const FIRST_LOOK_DAYS = 3; // how far back to look the first time (or if the "last checked" note can't be saved)
const OVERLAP_MS = 10 * 60 * 1000; // re-read the last few minutes each time, so nothing slips between two checks
const MIN_GAP_MS = 30 * 1000;
const MAX_LISTED = 80; // newest emails looked at per check
const MAX_DOWNLOADED = 20; // of those, the ones worth reading in full
const MAX_SUPPLIER_MAILS = 6; // supplier invoice emails read per check
const tail = (s) => String(s || "").replace(/\D/g, "").slice(-9);

const sameOrigin = (req) => {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin) {
    try { return new URL(origin).host === host; } catch { return false; }
  }
  return req.headers.get("sec-fetch-site") === "same-origin";
};
const hasKey = (req) => {
  const expected = process.env.PHONE_AGENT_API_KEY;
  if (!expected) return false;
  const a = Buffer.from(req.headers.get("x-api-key") || "");
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const configured = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

let running = false;
let lastRun = 0;

// New emails worth acting on -> [{ kind: "hipages"|"client", messageId, receivedAt, subject, text, display, address, headers }]
// `keep(summary)` decides, from the envelope and headers alone, which ones are downloaded in full.
async function fetchEmails(since, keep, seenSupplier = new Set()) {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST || "imap.gmail.com",
    port: Number(process.env.IMAP_PORT) || 993,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: String(process.env.GMAIL_APP_PASSWORD).replace(/\s+/g, "") },
    logger: false,
    socketTimeout: 40000,
  });
  const found = [];
  const supplierMails = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const uids = (await client.search({ since: new Date(since.getTime() - 24 * 3600 * 1000) }, { uid: true })) || [];
      // First pass: just who it's from, the subject and a few headers (cheap).
      const listed = [];
      const wanted = ["list-unsubscribe", "list-id", "precedence", "auto-submitted", "in-reply-to", "references", "message-id"];
      if (uids.length) {
        for await (const m of client.fetch(uids.slice(-MAX_LISTED).join(","), { uid: true, envelope: true, internalDate: true, headers: wanted, bodyStructure: true }, { uid: true })) {
          const from = m.envelope?.from?.[0] || {};
          listed.push({
            uid: m.uid,
            receivedAt: new Date(m.internalDate),
            subject: m.envelope?.subject || "",
            display: from.name || "",
            address: from.address || "",
            headers: headerMap(m.headers ? m.headers.toString("utf8") : ""),
            attachments: attachmentsOf(m.bodyStructure),
          });
        }
      }
      // Second pass: download in full only the ones that could matter.
      const candidates = listed
        .filter((s) => s.receivedAt > since)
        .map((s) => ({ ...s, kind: classify({ address: s.address, subject: s.subject, headers: s.headers, self: process.env.GMAIL_USER }) }))
        .filter((s) => !looksLikeSupplierMail(s)) // a supplier invoice is never a lead
        .filter((s) => s.kind && (s.kind === "hipages" ? isJobDetails({ from: s.address, subject: s.subject }) : keep(s)))
        .slice(-MAX_DOWNLOADED);
      // Supplier invoices and receipts (a PDF or photo from Our Town, Bunnings...): downloaded separately, once each.
      const supKey = (s) => s.headers["message-id"] || `uid${s.uid}`;
      const supplierCandidates = listed.filter((s) => s.receivedAt > since && looksLikeSupplierMail(s) && !seenSupplier.has(supKey(s))).slice(-MAX_SUPPLIER_MAILS);
      for (const s of supplierCandidates) {
       try {
        const msg = await client.fetchOne(String(s.uid), { source: true }, { uid: true });
        if (!msg?.source) continue;
        const mail = await simpleParser(msg.source);
        if (/\bdmarc=fail\b/i.test(String(mail.headers?.get("authentication-results") || ""))) continue;
        const attachments = (mail.attachments || [])
          .filter((a) => /^(?:application\/pdf|image\/(?:jpeg|jpg|png|heic|heif|webp))$/i.test(a.contentType || "") && a.size <= 6 * 1024 * 1024 && (/pdf/i.test(a.contentType) || a.size > 30000))
          .slice(0, 4)
          .map((a) => ({ filename: a.filename || "", mediaType: a.contentType, base64: a.content.toString("base64") }));
        if (attachments.length) supplierMails.push({ key: supKey(s), messageId: mail.messageId || `uid${s.uid}`, subject: s.subject, display: s.display, address: s.address, receivedAt: s.receivedAt, attachments });
       } catch (e) {
        console.log("inbox: a supplier email couldn't be downloaded —", String(e?.message || e).slice(0, 100)); // never lets this hold up the leads
       }
      }
      for (const s of candidates) {
        const msg = await client.fetchOne(String(s.uid), { source: true }, { uid: true });
        if (!msg?.source) continue;
        const mail = await simpleParser(msg.source);
        // A forged email that merely claims to be from someone fails these checks in Gmail's own headers.
        const auth = String(mail.headers?.get("authentication-results") || "");
        if (/\b(dmarc|dkim|spf)=fail\b/i.test(auth)) continue;
        found.push({ ...s, messageId: mail.messageId || `uid${s.uid}`, text: mail.text || "" });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  found.supplier = supplierMails;
  return found;
}

export async function GET(req) {
  const base = { configured: configured() && !!supabaseAdmin, aiKeySet: !!process.env.ANTHROPIC_API_KEY };
  // ?ai=check (only with the x-api-key header): a tiny test call to each Claude model the hub uses, so a wrong model name or a bad key shows up
  if (new URL(req.url).searchParams.get("ai") === "check" && hasKey(req)) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const results = {};
    if (process.env.ANTHROPIC_API_KEY) {
      const client = new Anthropic({ timeout: 20000, maxRetries: 0 });
      for (const model of ["claude-haiku-5-5", "claude-sonnet-4-6"]) {
        try {
          await client.messages.create({ model, max_tokens: 5, messages: [{ role: "user", content: "Reply with ok" }] });
          results[model] = "ok";
        } catch (e) {
          results[model] = `${e?.status || ""} ${String(e?.message || e).slice(0, 140)}`.trim();
        }
      }
    }
    return NextResponse.json({ ...base, results }, NO_STORE);
  }
  return NextResponse.json(base, NO_STORE);
}

export async function POST(req) {
  if (!sameOrigin(req) && !hasKey(req)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!configured()) return NextResponse.json({ configured: false });
  if (!supabaseAdmin) return NextResponse.json({ error: "Database not configured" }, { status: 501 });
  // remember that the outside timer (cron-job.org) is calling, so the Board can say whether it's set up
  if (hasKey(req)) await supabaseAdmin.from("expenses").upsert({ id: "sys-timer", category: "System", description: JSON.stringify({ last: new Date().toISOString() }), amount: "0", date: new Date().toISOString().slice(0, 10) });
  if (running || Date.now() - lastRun < MIN_GAP_MS) return NextResponse.json({ configured: true, skipped: true });
  running = true;
  const startedAt = new Date();
  try {
    // When it last looked is kept on the settings row (column added by migration 9). Without it, the last few days are checked each time.
    const { data: srows } = await supabaseAdmin.from("settings").select("*").limit(1);
    const settings = (srows || [])[0] || null;
    const canRemember = !!settings && "inboxCursor" in settings;
    const cursor = canRemember && settings.inboxCursor ? new Date(settings.inboxCursor) : null;
    const since = cursor && !Number.isNaN(cursor.getTime()) ? new Date(cursor.getTime() - OVERLAP_MS) : new Date(Date.now() - FIRST_LOOK_DAYS * 24 * 3600 * 1000);

    const { data: leadRows, error: leadErr } = await supabaseAdmin.from("leads").select("id,name,phone,email,address,notes");
    if (leadErr) throw new Error(leadErr.message);
    const leads = [...(leadRows || [])];
    const knownEmails = new Set(leads.map((l) => String(l.email || "").trim().toLowerCase()).filter(Boolean));

    // A reply is only worth downloading if it's from someone who is already a lead; a first email from a stranger always is.
    // a client's reply counts too when they have a quote but no lead
    const knownNames = new Set(leads.flatMap((l) => nameKeys(l.name)));
    for (const q of (await supabaseAdmin.from("quotes").select("clientEmail,clientName")).data || []) {
      const x = String(q.clientEmail || "").trim().toLowerCase();
      if (x) knownEmails.add(x);
      for (const k of nameKeys(q.clientName)) knownNames.add(k);
    }
    // A reply is worth reading when it's from a known address, from someone whose name is a lead or a client (they may be writing from
    // an address the hub never saw, like a quote that was emailed before the hub did it), or it's a reply to one of your own quote emails.
    // supplier-invoice emails already looked at (kept in one small row, newest 300), so a re-read never pays Claude twice for the same email
    const SUP_SEEN_ID = "sys-seen-sup";
    const { data: supSeenRow } = await supabaseAdmin.from("expenses").select("description").eq("id", SUP_SEEN_ID).maybeSingle();
    let supSeenList = [];
    try { supSeenList = JSON.parse(supSeenRow?.description || "[]") || []; } catch { supSeenList = []; }
    const emails = await fetchEmails(since, (s) => !isReply(s) || knownEmails.has(String(s.address).toLowerCase()) || nameKeys(s.display).some((k) => knownNames.has(k)) || /lyons fencing/i.test(s.subject), new Set(supSeenList));
    let quotesCache = null; // loaded only if an email sounds like an acceptance or a decline
    const loadQuotes = async () => {
      if (!quotesCache) quotesCache = (await supabaseAdmin.from("quotes").select("id,docNumber,clientName,clientPhone,clientEmail,address,suburb,jobType,status,date")).data || [];
      return quotesCache;
    };
    // emails already folded into a lead's notes (kept in one small row, newest 300), so a re-read never folds the same email twice
    const SEEN_ID = "sys-folded";
    const { data: seenRow } = await supabaseAdmin.from("expenses").select("description").eq("id", SEEN_ID).maybeSingle();
    let seenList = [];
    try { seenList = JSON.parse(seenRow?.description || "[]") || []; } catch { seenList = []; }
    const seenSet = new Set(seenList);
    let seenChanged = false;
    const created = [];
    const updated = [];
    const alerts = []; // phone alerts to send once the inbox has been read
    let alreadyHave = 0;
    let unreadable = 0;

    for (const e of emails.sort((a, b) => a.receivedAt - b.receivedAt)) {
      if (e.kind === "hipages") {
        const row = parseJobDetails({ subject: e.subject, text: e.text, receivedAt: e.receivedAt, key: e.messageId });
        if (!row) { unreadable++; console.log("inbox: a hipages job-details email couldn't be read (layout not recognised)"); continue; }
        const dupe = leads.some((l) => l.id === row.id || (tail(row.phone).length === 9 && tail(l.phone) === tail(row.phone)) || (row.email && String(l.email || "").toLowerCase() === row.email));
        if (dupe) { alreadyHave++; continue; }
        const { error } = await supabaseAdmin.from("leads").upsert(row, { onConflict: "id", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
        leads.push(row);
        created.push(row.name);
        alerts.push({ title: `New hipages lead: ${row.name || "someone"}`, body: `${[row.address, row.jobType].filter(Boolean).join(" · ") || "Job details are in"}. Reply now, the first text wins.`, tag: `lead-${row.id}`, url: "/" });
        console.log("inbox: new lead added from a hipages job-details email");
        continue;
      }

      // A person's email.
      const lead = matchLead(leads, { address: e.address, text: e.text, display: isReply(e) ? e.display : "" });
      if (lead) {
        // "Yep go ahead" / "we've gone with someone else": moves their one sent quote to Accepted / Declined.
        let dec = null;
        const fresh = cleanBody(e.text);
        if (detectDecision(fresh)) {
          dec = decideQuote({ lead, quotes: await loadQuotes(), text: fresh, via: "email", now: e.receivedAt });
          if (dec && (dec.ambiguous || !(await saveDecision(supabaseAdmin, dec)))) dec = null;
        }
        const change = applyClientMessage(lead, e.text, e.receivedAt, { skipCancel: !!dec, display: e.display, address: e.address });
        if (!change && !dec) continue;
        const patch = { ...(change?.patch || {}) };
        const applied = [...(change?.applied || [])];
        if (change?.fold) {
          const mid = String(e.messageId || `${lead.id}-${e.receivedAt?.getTime?.() || ""}-${change.fold.text.slice(0, 30)}`);
          if (!seenSet.has(mid)) {
            seenSet.add(mid);
            seenList.push(mid);
            seenChanged = true;
            const base = patch.notes ?? String(lead.notes || "");
            const folded = await foldUpdate(base, change.fold);
            if (folded !== base) { patch.notes = folded.slice(-4000); applied.push("details"); }
          }
        }
        if (!applied.length && !dec) continue;
        if (dec) {
          patch.status = dec.leadPatch.status;
          patch.notes = [patch.notes ?? String(lead.notes || ""), dec.noteLine].filter((x) => String(x).trim()).join("\n").slice(-4000);
          applied.push(`quote ${dec.decision === "accept" ? "accepted" : "declined"}`);
        }
        if (!lead.email && e.address) patch.email = String(e.address).toLowerCase(); // learn their email while we're here
        const { error } = await supabaseAdmin.from("leads").update(patch).eq("id", lead.id);
        if (error) throw new Error(error.message);
        if (patch.name) await renameClient(supabaseAdmin, lead, patch.name);
        Object.assign(lead, patch);
        updated.push(`${lead.name} (${applied.join(", ")})`);
        console.log(`inbox: lead updated from an email (${applied.join(", ")})`);
        continue;
      }
      // An email from a client who has a quote but no lead is that client: keep what matters, on a lead under their own name.
      const client = clientFromQuotes(await loadQuotes(), { phone: findPhone(cleanBody(e.text)), email: e.address });
      if (client) {
        const rel = relevantParts(cleanBody(e.text), { max: 320 });
        const id = `eml${String(client.phone || e.address).replace(/\D/g, "").slice(-9) || String(e.address).replace(/[^a-z0-9]/gi, "").slice(0, 24).toLowerCase()}`;
        if (!rel || leads.some((l) => l.id === id)) continue;
        const row = { id, name: client.name || e.display || "Client", phone: client.phone || "", email: client.email || String(e.address).toLowerCase(), address: client.address || "", jobType: client.jobType || "Other", status: client.status, notes: `Text ${new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short" }).format(e.receivedAt)} (email): ${rel.replace(/\s*\n\s*/g, " ")}`, createdAt: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(e.receivedAt), source: "email" };
        const { error } = await supabaseAdmin.from("leads").upsert(row, { onConflict: "id", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
        leads.push(row);
        updated.push(`${row.name} (client's email kept)`);
        continue;
      }
      if (isReply(e)) continue;
      const row = leadFromEmail({ display: e.display, address: e.address, subject: e.subject, text: e.text, receivedAt: e.receivedAt });
      if (!row) continue;
      if (leads.some((l) => l.id === row.id)) { alreadyHave++; continue; }
      const { error } = await supabaseAdmin.from("leads").upsert(row, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      leads.push(row);
      created.push(row.name);
      alerts.push({ title: `New enquiry: ${row.name || "someone"}`, body: `${[row.address, row.jobType].filter(Boolean).join(" · ") || "From an email"}`, tag: `lead-${row.id}`, url: "/" });
      console.log("inbox: new lead added from an enquiry email");
    }

    // supplier invoices from email: read, and queued on the Finances tab for you to check
    let supplierQueued = 0;
    const supplierMails = emails.supplier || [];
    if (supplierMails.length) {
      try {
        const r = await importSupplierMails(supabaseAdmin, supplierMails);
        if (r.handled.length) {
          supSeenList.push(...r.handled);
          await supabaseAdmin.from("expenses").upsert({ id: SUP_SEEN_ID, category: "System", description: JSON.stringify(supSeenList.slice(-300)), amount: "0", date: new Date().toISOString().slice(0, 10) });
        }
        supplierQueued = r.queued.length;
        for (const q of r.queued) alerts.push({ title: `Supplier invoice to check: ${q.supplier}`, body: `$${Number(q.total).toFixed(2)}. Open Finances and pick the job it was for.`, tag: `sup-${Math.round(q.total * 100)}`, url: "/" });
      } catch (e) {
        console.log("inbox: supplier invoices couldn't be imported —", String(e?.message || e).slice(0, 100));
      }
    }
    if (seenChanged) await supabaseAdmin.from("expenses").upsert({ id: SEEN_ID, category: "System", description: JSON.stringify(seenList.slice(-300)), amount: "0", date: new Date().toISOString().slice(0, 10) });
    if (canRemember) {
      await supabaseAdmin.from("settings").update({ inboxCursor: startedAt.toISOString() }).eq("id", settings.id);
    }
    // phone alerts (no-ops until the VAPID keys are set): the new ones straight away, then reminders for hipages leads nobody has replied to
    let alerted = 0;
    try {
      for (const a of alerts) alerted += (await sendPush(supabaseAdmin, a)).sent;
      await nudgeUnanswered(supabaseAdmin);
      await dailyTextsDigest(supabaseAdmin);
    } catch (e) {
      console.log("inbox: phone alerts failed —", String(e?.message || e).slice(0, 120));
    }
    lastRun = Date.now();
    return NextResponse.json({ configured: true, alerted, supplierQueued, checked: emails.length, created: created.length, updated: updated.length, names: created, changes: updated, alreadyHave, unreadable, remembers: canRemember });
  } catch (e) {
    lastRun = Date.now();
    const msg = String(e?.message || e);
    console.log(`inbox: check failed — ${msg.slice(0, 200)}`);
    const auth = /auth|invalid credentials|login/i.test(msg);
    return NextResponse.json({ configured: true, error: auth ? "Gmail wouldn't let the hub read the inbox (check the app password, and that IMAP is on in Gmail settings)." : `Couldn't check the inbox: ${msg.slice(0, 160)}` });
  } finally {
    running = false;
  }
}
