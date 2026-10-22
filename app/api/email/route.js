// Email a quote or invoice (or a follow-up / start-date / payment reminder) to the client, from the business Gmail account.
//   GET  -> is sending set up?
//   POST { kind, id, preview?, subject?, body? }
//        preview: true  -> returns who it would go to and the wording (nothing is sent)
//        otherwise      -> sends it, attaches the PDF where it makes sense, and records that it was sent.
// The hub has no login, so this is deliberately narrow: the recipient is ALWAYS the email saved on that quote/invoice (or on
// the matching lead) and never comes from the request, only the app's own pages may call it, the same document can't be sent
// twice within two minutes, and there is a daily limit.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { renderPdf } from "@/lib/pdf";
import { KINDS, DAILY_CAP, COOLDOWN_SECONDS, getMailer, composeEmail, sendEmail, isEmail } from "@/lib/email";

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
  if (!sameOrigin(req)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Database not configured" }, { status: 501 });

  const body = await req.json().catch(() => ({}));
  const spec = KINDS[body.kind];
  if (!spec || !body.id) return NextResponse.json({ error: "Unknown kind or missing id" }, { status: 400 });

  const { data: rec, error } = await supabaseAdmin.from(spec.table).select("*").eq("id", body.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rec) return NextResponse.json({ error: "Couldn't find that document" }, { status: 404 });
  if (!("lastEmailed" in rec)) {
    return NextResponse.json({ error: "Emailing needs one small database update first (migration 8 in the supabase folder).", needsMigration: true }, { status: 501 });
  }

  // Who it goes to: the email saved on the document, else the matching lead's.
  let to = String(rec.clientEmail || "").trim();
  if (!isEmail(to)) {
    const { data: leads } = await supabaseAdmin.from("leads").select("name,phone,email");
    const quoteForPhone = spec.table === "invoices" && rec.quoteId ? (await supabaseAdmin.from("quotes").select("clientPhone,clientEmail").eq("id", rec.quoteId).maybeSingle()).data : null;
    const phone = tail(rec.clientPhone || quoteForPhone?.clientPhone);
    const lead = (leads || []).find((l) => isEmail(l.email) && ((phone.length >= 8 && tail(l.phone) === phone) || norm(l.name) === norm(rec.clientName)));
    to = quoteForPhone && isEmail(quoteForPhone.clientEmail) ? quoteForPhone.clientEmail.trim() : lead?.email?.trim() || "";
  }

  const origin = req.headers.get("origin") || `https://${req.headers.get("host")}`;
  const composed = composeEmail(body.kind, rec, { origin });
  const subject = String(body.subject ?? composed.subject).slice(0, 200).replace(/[\r\n]+/g, " ").trim() || composed.subject;
  const text = String(body.body ?? composed.text).slice(0, 4000);
  const mailer = getMailer();
  const attachmentName = spec.pdf ? `${spec.label} ${rec.docNumber || ""}.pdf`.trim() : null;

  if (body.preview) {
    return NextResponse.json({ ok: true, configured: !!mailer, from: mailer?.user || null, to: isEmail(to) ? to : "", subject, body: text, attachment: attachmentName, name: rec.clientName || "" }, NO_STORE);
  }

  if (!mailer) return NextResponse.json({ error: "Email isn't set up yet — add GMAIL_USER and GMAIL_APP_PASSWORD." }, { status: 501 });
  if (!isEmail(to)) return NextResponse.json({ error: "There's no email address saved for this client. Add one and try again.", needsEmail: true }, { status: 422 });
  if (rec.lastEmailed && Date.now() - Date.parse(rec.lastEmailed) < COOLDOWN_SECONDS * 1000) {
    return NextResponse.json({ error: "That was only just sent — wait a couple of minutes before sending it again." }, { status: 429 });
  }
  const since = startOfTodayBrisbane();
  const counts = await Promise.all(["quotes", "invoices"].map((t) => supabaseAdmin.from(t).select("id", { count: "exact", head: true }).gte("lastEmailed", since)));
  if (counts.reduce((n, c) => n + (c.count || 0), 0) >= DAILY_CAP) {
    return NextResponse.json({ error: `That's the daily limit of ${DAILY_CAP} emails. It resets tomorrow.` }, { status: 429 });
  }

  try {
    const attachments = [];
    if (spec.pdf) {
      const { pdf, filename } = await renderPdf(spec.pdf, rec);
      attachments.push({ filename, content: pdf, contentType: "application/pdf" });
    }
    await sendEmail({ mailer, to, subject, text, attachments });
  } catch (e) {
    console.error("email send failed", e.message);
    return NextResponse.json({ error: `Couldn't send: ${e.message}` }, { status: 502 });
  }

  // Record it, so it isn't offered again and the quote moves on.
  const patch = { lastEmailed: new Date().toISOString() };
  const marked = [];
  if (!isEmail(rec.clientEmail)) patch.clientEmail = to; // remember the address that worked
  if (body.kind === "quote" && rec.status === "Draft") { patch.status = "Sent"; marked.push("Marked the quote as Sent."); }
  if (body.kind === "followup") patch.lastFollowUp = todayBrisbane();
  if (body.kind === "start") patch.lastFollowUp = `start:${rec.startDate}`;
  if (body.kind === "chase") patch.lastChase = todayBrisbane();
  try {
    await safeUpdate(spec.table, rec.id, patch);
  } catch (e) {
    console.error("email sent but couldn't record it", e.message);
  }
  return NextResponse.json({ ok: true, to, marked, attached: attachments.map((a) => a.filename), test: !!mailer.test }, NO_STORE);
}
