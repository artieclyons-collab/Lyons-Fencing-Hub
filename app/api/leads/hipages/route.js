// Brings hipages leads into the hub. When you accept a hipages lead, hipages emails the client's details to the business Gmail;
// this reads those emails (and only those) and adds each client as a new lead with source "hipages".
//   GET  -> is it set up?
//   POST -> look for new "hipages Job Details" emails and add them. Safe to call as often as you like.
// Read-only: the mailbox is opened read-only, so nothing is ever marked read, moved, labelled or deleted. Uses the same
// GMAIL_USER / GMAIL_APP_PASSWORD as the quote emails. Called by the hub while it's open, or by an outside timer with x-api-key.
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isJobDetails, parseJobDetails } from "@/lib/hipages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { headers: { "Cache-Control": "no-store" } };
const FIRST_LOOK_DAYS = 3; // how far back to look the first time (or if the "last checked" note can't be saved)
const OVERLAP_MS = 10 * 60 * 1000; // re-read the last few minutes each time, so nothing slips between two checks
const MIN_GAP_MS = 30 * 1000;
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

// Messages that arrived after `since` and look like job-details emails -> [{ messageId, receivedAt, subject, text }]
async function fetchJobEmails(since) {
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
      const uids = await client.search({ since: new Date(since.getTime() - 24 * 3600 * 1000), from: "hipages.com.au", subject: "Job Details" }, { uid: true });
      for (const uid of (uids || []).slice(-40)) {
        const msg = await client.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
        if (!msg?.source) continue;
        const receivedAt = new Date(msg.internalDate);
        if (receivedAt <= since) continue;
        const mail = await simpleParser(msg.source);
        const from = mail.from?.value?.[0]?.address || "";
        if (!isJobDetails({ from, subject: mail.subject })) continue;
        // A forged email that merely claims to be from hipages fails these checks in Gmail's own headers.
        const auth = String(mail.headers?.get("authentication-results") || "");
        if (/\b(dmarc|dkim|spf)=fail\b/i.test(auth)) continue;
        found.push({ messageId: mail.messageId || `uid${uid}`, receivedAt, subject: mail.subject, text: mail.text || "" });
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
    const canRemember = !!settings && "hipagesCursor" in settings;
    const cursor = canRemember && settings.hipagesCursor ? new Date(settings.hipagesCursor) : null;
    const since = cursor && !Number.isNaN(cursor.getTime()) ? new Date(cursor.getTime() - OVERLAP_MS) : new Date(Date.now() - FIRST_LOOK_DAYS * 24 * 3600 * 1000);

    const emails = await fetchJobEmails(since);
    const created = [];
    let alreadyHave = 0;
    let unreadable = 0;
    if (emails.length) {
      const { data: leads, error } = await supabaseAdmin.from("leads").select("id,phone,email");
      if (error) throw new Error(error.message);
      const phones = new Set((leads || []).map((l) => tail(l.phone)).filter((p) => p.length === 9));
      const mails = new Set((leads || []).map((l) => String(l.email || "").trim().toLowerCase()).filter(Boolean));
      const ids = new Set((leads || []).map((l) => l.id));
      for (const e of emails.sort((a, b) => a.receivedAt - b.receivedAt)) {
        const row = parseJobDetails({ subject: e.subject, text: e.text, receivedAt: e.receivedAt, key: e.messageId });
        if (!row) { unreadable++; console.log("hipages: a job-details email couldn't be read (layout not recognised)"); continue; }
        if (ids.has(row.id) || (tail(row.phone).length === 9 && phones.has(tail(row.phone))) || (row.email && mails.has(row.email))) { alreadyHave++; continue; }
        const { error: insErr } = await supabaseAdmin.from("leads").upsert(row, { onConflict: "id", ignoreDuplicates: true });
        if (insErr) throw new Error(insErr.message);
        ids.add(row.id);
        if (tail(row.phone).length === 9) phones.add(tail(row.phone));
        if (row.email) mails.add(row.email);
        created.push(row.name);
        console.log("hipages: new lead added from a job-details email");
      }
    }
    if (canRemember) {
      await supabaseAdmin.from("settings").update({ hipagesCursor: new Date(startedAt.getTime()).toISOString() }).eq("id", settings.id);
    }
    lastRun = Date.now();
    return NextResponse.json({ configured: true, checked: emails.length, created: created.length, names: created, alreadyHave, unreadable, remembers: canRemember });
  } catch (e) {
    lastRun = Date.now();
    const msg = String(e?.message || e);
    console.log(`hipages: check failed — ${msg.slice(0, 200)}`);
    const auth = /auth|invalid credentials|login/i.test(msg);
    return NextResponse.json({ configured: true, error: auth ? "Gmail wouldn't let the hub read the inbox (check the app password, and that IMAP is on in Gmail settings)." : `Couldn't check hipages emails: ${msg.slice(0, 160)}` });
  } finally {
    running = false;
  }
}
