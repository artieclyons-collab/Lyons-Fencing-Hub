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
import { headerMap, classify, isReply, leadFromEmail, applyClientMessage, matchLead, cleanBody } from "@/lib/inboxLeads";
import { detectDecision, decideQuote, saveDecision } from "@/lib/quoteDecision";
import { renameClient } from "@/lib/leadName";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { headers: { "Cache-Control": "no-store" } };
const FIRST_LOOK_DAYS = 3; // how far back to look the first time (or if the "last checked" note can't be saved)
const OVERLAP_MS = 10 * 60 * 1000; // re-read the last few minutes each time, so nothing slips between two checks
const MIN_GAP_MS = 30 * 1000;
const MAX_LISTED = 80; // newest emails looked at per check
const MAX_DOWNLOADED = 20; // of those, the ones worth reading in full
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
async function fetchEmails(since, keep) {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST || "imap.gmail.com",
    port: Number(process.env.IMAP_PORT) || 993,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: String(process.env.GMAIL_APP_PASSWORD).replace(/\s+/g, "") },
    logger: false,
    socketTimeout: 40000,
  });
  const found = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const uids = (await client.search({ since: new Date(since.getTime() - 24 * 3600 * 1000) }, { uid: true })) || [];
      // First pass: just who it's from, the subject and a few headers (cheap).
      const listed = [];
      const wanted = ["list-unsubscribe", "list-id", "precedence", "auto-submitted", "in-reply-to", "references"];
      if (uids.length) {
        for await (const m of client.fetch(uids.slice(-MAX_LISTED).join(","), { uid: true, envelope: true, internalDate: true, headers: wanted }, { uid: true })) {
          const from = m.envelope?.from?.[0] || {};
          listed.push({
            uid: m.uid,
            receivedAt: new Date(m.internalDate),
            subject: m.envelope?.subject || "",
            display: from.name || "",
            address: from.address || "",
            headers: headerMap(m.headers ? m.headers.toString("utf8") : ""),
          });
        }
      }
      // Second pass: download in full only the ones that could matter.
      const candidates = listed
        .filter((s) => s.receivedAt > since)
        .map((s) => ({ ...s, kind: classify({ address: s.address, subject: s.subject, headers: s.headers, self: process.env.GMAIL_USER }) }))
        .filter((s) => s.kind && (s.kind === "hipages" ? isJobDetails({ from: s.address, subject: s.subject }) : keep(s)))
        .slice(-MAX_DOWNLOADED);
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
  return found;
}

export async function GET() {
  return NextResponse.json({ configured: configured() && !!supabaseAdmin }, NO_STORE);
}

export async function POST(req) {
  if (!sameOrigin(req) && !hasKey(req)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!configured()) return NextResponse.json({ configured: false });
  if (!supabaseAdmin) return NextResponse.json({ error: "Database not configured" }, { status: 501 });
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
    const emails = await fetchEmails(since, (s) => !isReply(s) || knownEmails.has(String(s.address).toLowerCase()));
    let quotesCache = null; // loaded only if an email sounds like an acceptance or a decline
    const loadQuotes = async () => {
      if (!quotesCache) quotesCache = (await supabaseAdmin.from("quotes").select("id,docNumber,clientName,clientPhone,clientEmail,status")).data || [];
      return quotesCache;
    };
    const created = [];
    const updated = [];
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
        console.log("inbox: new lead added from a hipages job-details email");
        continue;
      }

      // A person's email.
      const lead = matchLead(leads, { address: e.address, text: e.text });
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
      if (isReply(e)) continue;
      const row = leadFromEmail({ display: e.display, address: e.address, subject: e.subject, text: e.text, receivedAt: e.receivedAt });
      if (!row) continue;
      if (leads.some((l) => l.id === row.id)) { alreadyHave++; continue; }
      const { error } = await supabaseAdmin.from("leads").upsert(row, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      leads.push(row);
      created.push(row.name);
      console.log("inbox: new lead added from an enquiry email");
    }

    if (canRemember) {
      await supabaseAdmin.from("settings").update({ inboxCursor: startedAt.toISOString() }).eq("id", settings.id);
    }
    lastRun = Date.now();
    return NextResponse.json({ configured: true, checked: emails.length, created: created.length, updated: updated.length, names: created, changes: updated, alreadyHave, unreadable, remembers: canRemember });
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
