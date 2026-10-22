// Emails to clients, sent from the business Gmail account (server-only). The wording lives here; the screen shows a
// preview you can edit before anything is sent. Uses a Gmail "app password" over SMTP:
//   GMAIL_USER (e.g. Lyonsfencingservices@gmail.com) and GMAIL_APP_PASSWORD (16 characters from Google Account → Security).
import nodemailer from "nodemailer";
import { BIZ } from "./constants";
import { money, itemsTotal, gstBreakdown, isDepositInvoice } from "./logic";

export const KINDS = {
  quote: { table: "quotes", pdf: "quote", label: "Quote" },
  followup: { table: "quotes", pdf: null, label: "Quote follow-up" },
  start: { table: "quotes", pdf: null, label: "Start date" },
  invoice: { table: "invoices", pdf: "invoice", label: "Invoice" },
  chase: { table: "invoices", pdf: "invoice", label: "Payment reminder" },
};

export const DAILY_CAP = 40; // emails a day, so a mistake or a stranger poking the hub can't flood your clients
export const COOLDOWN_SECONDS = 120; // the same document can't be sent again straight away

export const isEmail = (s) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(String(s || "").trim());

// The sending side. Null until GMAIL_USER and GMAIL_APP_PASSWORD are set. EMAIL_TEST_MODE=json builds the message but sends nothing.
export function getMailer(env = process.env) {
  if (env.EMAIL_TEST_MODE === "json") return { transport: nodemailer.createTransport({ jsonTransport: true }), user: env.GMAIL_USER || "test@example.com", test: true };
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return null;
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: env.GMAIL_USER, pass: String(env.GMAIL_APP_PASSWORD).replace(/\s+/g, "") }, // Google shows it in 4 groups of 4
  });
  return { transport, user: env.GMAIL_USER, test: false };
}

const first = (name) => {
  const n = String(name || "").replace(/\(.*?\)/g, "").trim().split(/\s+/)[0] || "";
  return /^(n\/?a|lead|client)$/i.test(n) ? "" : n;
};
const longDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "");
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 86400000) : 0);
const signoff = `Cheers,\nArtie\n${BIZ.name}\n${BIZ.phone} | ${BIZ.website}`;
const bank = (doc) =>
  `Payment details:\nAccount name: ${BIZ.bankAccountName}\nBSB: ${BIZ.bsb}\nAccount number: ${BIZ.accountNumber}\nReference: ${doc || "your invoice number"}`;

// -> { subject, text } for one kind of email about one record (a quote or an invoice).
export function composeEmail(kind, rec, { origin = "" } = {}) {
  const name = first(rec.clientName);
  const hi = `Hi${name ? ` ${name}` : ""},`;
  const doc = rec.docNumber || "";
  const total = money(gstBreakdown(itemsTotal(rec.items)).total);

  if (kind === "quote") {
    return {
      subject: `Your quote from ${BIZ.name}${doc ? ` (${doc})` : ""}`,
      text: [
        hi,
        `Thanks for having me out to have a look at the job. Your quote${doc ? ` (${doc})` : ""} for ${total} inc. GST is attached.`,
        origin && rec.id ? `You can also view it and accept it online here:\n${origin}/accept/${rec.id}` : "",
        `The quote is valid for 3 months. If you have any questions, just reply to this email or call me on ${BIZ.phone}.`,
        signoff,
      ].filter(Boolean).join("\n\n"),
    };
  }
  if (kind === "followup") {
    const days = daysSince(rec.date);
    return {
      subject: `Following up on your quote${doc ? ` (${doc})` : ""}`,
      text: [
        hi,
        `Just following up on the fencing quote${doc ? ` (${doc})` : ""} I sent through${days > 0 ? ` ${days} days ago` : ""}. Let me know if you have any questions or would like to go ahead.`,
        origin && rec.id ? `You can view and accept it online here:\n${origin}/accept/${rec.id}` : "",
        signoff,
      ].filter(Boolean).join("\n\n"),
    };
  }
  if (kind === "start") {
    const changed = String(rec.lastFollowUp || "").startsWith("start:");
    const date = longDate(rec.startDate);
    return {
      subject: changed ? "Your start date has changed" : "You're booked in",
      text: [
        hi,
        changed
          ? `Just letting you know your start date has changed to ${date}. Sorry for any inconvenience, and let me know if that doesn't suit.`
          : `Thanks for accepting the quote! I've got you booked in to start on ${date}. I'll be in touch beforehand if anything changes.`,
        signoff,
      ].join("\n\n"),
    };
  }
  const deposit = isDepositInvoice(rec);
  const what = `${deposit ? "the deposit invoice" : "invoice"}${doc ? ` ${doc}` : ""}`;
  if (kind === "invoice") {
    return {
      subject: `${deposit ? "Deposit invoice" : "Invoice"}${doc ? ` ${doc}` : ""} from ${BIZ.name}`,
      text: [
        hi,
        `Please find ${what} for ${total} inc. GST attached.${deposit ? " The deposit is due before works commence." : rec.dueDate ? ` Payment is due by ${longDate(rec.dueDate)}.` : ""}`,
        bank(doc),
        `If you have any questions, just reply to this email or call me on ${BIZ.phone}. Thank you!`,
        signoff,
      ].join("\n\n"),
    };
  }
  // chase
  return {
    subject: `Payment reminder${doc ? ` — ${doc}` : ""}`,
    text: [
      hi,
      `Just a quick reminder that ${what} for ${total} inc. GST is still outstanding. The invoice is attached again for convenience.`,
      bank(doc),
      `If you've already paid, please ignore this — and thank you! Otherwise let me know if you have any questions.`,
      signoff,
    ].join("\n\n"),
  };
}

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// A plain-text message as simple HTML (paragraphs, line breaks, clickable links) so it looks right in any mail app.
export function toHtml(text) {
  const body = String(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222">${body}</div>`;
}

export async function sendEmail({ mailer, to, subject, text, attachments = [] }) {
  const info = await mailer.transport.sendMail({
    from: `"${BIZ.name}" <${mailer.user}>`,
    replyTo: mailer.user,
    to,
    subject,
    text,
    html: toHtml(text),
    attachments,
  });
  return info;
}
