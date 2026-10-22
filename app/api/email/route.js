// Email a quote or invoice (or a follow-up / start-date / payment reminder) to the client, from the business Gmail account.
//   GET  -> is sending set up?
//   POST { kind, id, ids?, preview?, subject?, body? }
//        ids:           other quotes/invoices for the SAME client to send in the same email (the wording goes plural)
//        preview: true  -> returns who it would go to, the wording, and the client's other documents (nothing is sent)
//        otherwise      -> sends it, attaches the PDFs where it makes sense, and records that it was sent.
// The hub has no login, so this is deliberately narrow: the recipient is ALWAYS the email saved on the quote/invoice (or on
// the matching lead) and never comes from the request, only the app's own pages may call it, the same document can't be sent
// twice within two minutes, and there is a daily limit.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { renderPdf } from "@/lib/pdf";
import { buildFilename, money, itemsTotal, gstBreakdown } from "@/lib/logic";
import { KINDS, DAILY_CAP, COOLDOWN_SECONDS, MAX_DOCS, getMailer, composeEmail, sendEmail, isEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };
const tail = (s) => String(s || "").replace(/\D/g, "").slice(-9);
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const startOfTodayBrisbane = () => {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date());
  return new Date(`${d}T00:00:00+10:00`).toISOString();
};
const todayBrisbane = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date());

const sameOrigin = (req) => {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin) {
    try { return new URL(origin).host === host; } catch { return false; }
  }
  return req.headers.get("sec-fetch-site") === "same-origin";
};

// Updates a row, leaving out any column the database doesn't have yet.
async function safeUpdate(table, id, patch) {
  let cur = { ...patch };
  for (let i = 0; i < 6; i++) {
    const { error } = await supabaseAdmin.from(table).update(cur).eq("id", id);
    if (!error) return;
    const missing = /Could not find the '([^']+)' column/.exec(error.message || "")?.[1];
    if (!missing || !(missing in cur)) throw new Error(error.message);
    delete cur[missing];
  }
}

export async function GET() {
  const m = getMailer();
  return NextResponse.json({ configured: !!m, from: m?.user || null, test: !!m?.test }, NO_STORE);
}

export async function POST(req) {
  // Whatever goes wrong, answer with a readable reason (and log it) rather than a bare server error.
  try {
    return await handle(req);
  } catch (e) {
    console.error("email route failed:", e?.stack || e);
    return NextResponse.json({ error: `Something went wrong: ${e?.message || e}` }, { status: 500 });
  }
}

async function handle(req) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Database not configured" }, { status: 501 });

  const body = await req.json().catch(() => ({}));
  const spec = KINDS[body.kind];
  if (!spec || !body.id) return NextResponse.json({ error: "Unknown kind or missing id" }, { status: 400 });

  const ids = [...new Set([body.id, ...(Array.isArray(body.ids) ? body.ids : [])].map(String))].slice(0, MAX_DOCS);
  const { data: found, error } = await supabaseAdmin.from(spec.table).select("*").in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const recs = ids.map((i) => (found || []).find((r) => r.id === i)).filter(Boolean);
  if (recs.length !== ids.length) return NextResponse.json({ error: "Couldn't find that document" }, { status: 404 });
  if (!("lastEmailed" in recs[0])) {
    return NextResponse.json({ error: "Emailing needs one small database update first (migration 8 in the supabase folder).", needsMigration: true }, { status: 501 });
  }
  const client = norm(recs[0].clientName);
  if (recs.some((r) => norm(r.clientName) !== client)) return NextResponse.json({ error: "Those belong to different clients, so they can't go in one email." }, { status: 400 });

  // Who it goes to: the email saved on the document, else on its quote, else the matching lead's.
  const { data: leads } = await supabaseAdmin.from("leads").select("name,phone,email");
  const emailFor = async (rec) => {
    if (isEmail(rec.clientEmail)) return rec.clientEmail.trim();
    const quote = spec.table === "invoices" && rec.quoteId ? (await supabaseAdmin.from("quotes").select("clientPhone,clientEmail").eq("id", rec.quoteId).maybeSingle()).data : null;
    if (quote && isEmail(quote.clientEmail)) return quote.clientEmail.trim();
    const phone = tail(rec.clientPhone || quote?.clientPhone);
    const lead = (leads || []).find((l) => isEmail(l.email) && ((phone.length >= 8 && tail(l.phone) === phone) || norm(l.name) === norm(rec.clientName)));
    return lead?.email?.trim() || "";
  };
  const addresses = [...new Set((await Promise.all(recs.map(emailFor))).filter(Boolean))];
  if (addresses.length > 1) return NextResponse.json({ error: "Those have different email addresses saved, so they can't go in one email." }, { status: 400 });
  const to = addresses[0] || "";

  const composed = composeEmail(body.kind, recs);
  const subject = String(body.subject ?? composed.subject).slice(0, 200).replace(/[\r\n]+/g, " ").trim() || composed.subject;
  const text = String(body.body ?? composed.text).slice(0, 4000);
  const mailer = getMailer();
  const attachmentNames = spec.pdf ? recs.map((r) => `${buildFilename(spec.pdf, r)}.pdf`) : [];

  if (body.preview) {
    // The same client's other documents that could go in the same email.
    const { data: all } = await supabaseAdmin.from(spec.table).select("*");
    const eligible = (r) => (spec.table === "quotes" ? ["Draft", "Sent"].includes(r.status) : r.status !== "Paid");
    const others = spec.pdf
      ? (all || [])
          .filter((r) => !ids.includes(r.id) && norm(r.clientName) === client && eligible(r))
          .map((r) => ({ id: r.id, label: [r.docNumber, r.jobType, money(gstBreakdown(itemsTotal(r.items)).total)].filter(Boolean).join(" · ") }))
      : [];
    return NextResponse.json({ ok: true, configured: !!mailer, from: mailer?.user || null, to: isEmail(to) ? to : "", subject, body: text, attachments: attachmentNames, others, ids, name: recs[0].clientName || "" }, NO_STORE);
  }

  if (!mailer) return NextResponse.json({ error: "Email isn't set up yet — add GMAIL_USER and GMAIL_APP_PASSWORD." }, { status: 501 });
  if (!isEmail(to)) return NextResponse.json({ error: "There's no email address saved for this client. Add one and try again.", needsEmail: true }, { status: 422 });
  if (recs.some((r) => r.lastEmailed && Date.now() - Date.parse(r.lastEmailed) < COOLDOWN_SECONDS * 1000)) {
    return NextResponse.json({ error: "That was only just sent — wait a couple of minutes before sending it again." }, { status: 429 });
  }
  const since = startOfTodayBrisbane();
  const counts = await Promise.all(["quotes", "invoices"].map((t) => supabaseAdmin.from(t).select("id", { count: "exact", head: true }).gte("lastEmailed", since)));
  if (counts.reduce((n, c) => n + (c.count || 0), 0) >= DAILY_CAP) {
    return NextResponse.json({ error: `That's the daily limit of ${DAILY_CAP} emails. It resets tomorrow.` }, { status: 429 });
  }

  const attachments = [];
  try {
    if (spec.pdf) {
      for (const r of recs) {
        const { pdf, filename } = await renderPdf(spec.pdf, r);
        attachments.push({ filename, content: pdf, contentType: "application/pdf" });
      }
    }
    await sendEmail({ mailer, to, subject, text, attachments });
  } catch (e) {
    console.error("email send failed", e.message);
    return NextResponse.json({ error: `Couldn't send: ${e.message}` }, { status: 502 });
  }

  // Record it, so it isn't offered again and the quote moves on.
  const marked = [];
  for (const rec of recs) {
    const patch = { lastEmailed: new Date().toISOString() };
    if (!isEmail(rec.clientEmail)) patch.clientEmail = to; // remember the address that worked
    if (body.kind === "quote" && rec.status === "Draft") { patch.status = "Sent"; marked.push(`${rec.docNumber || "Quote"} marked as Sent.`); }
    if (body.kind === "followup") patch.lastFollowUp = todayBrisbane();
    if (body.kind === "start") patch.lastFollowUp = `start:${rec.startDate}`;
    if (body.kind === "chase") patch.lastChase = todayBrisbane();
    try {
      await safeUpdate(spec.table, rec.id, patch);
    } catch (e) {
      console.error("email sent but couldn't record it", e.message);
    }
  }
  return NextResponse.json({ ok: true, to, marked, attached: attachments.map((a) => a.filename), test: !!mailer.test }, NO_STORE);
}
