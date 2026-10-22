// Emails to clients, sent from the business Gmail account (server-only). The wording lives here; the screen shows a
// preview you can edit before anything is sent. Uses a Gmail "app password" over SMTP:
//   GMAIL_USER (e.g. Lyonsfencingservices@gmail.com) and GMAIL_APP_PASSWORD (16 characters from Google Account → Security).
import nodemailer from "nodemailer";
import { BIZ } from "./constants";
import { isDepositInvoice } from "./logic";
import { LOGO_DATA_URI } from "./logo";

export const KINDS = {
  quote: { table: "quotes", pdf: "quote", label: "Quote" },
  followup: { table: "quotes", pdf: null, label: "Quote follow-up" },
  start: { table: "quotes", pdf: null, label: "Start date" },
  invoice: { table: "invoices", pdf: "invoice", label: "Invoice" },
  chase: { table: "invoices", pdf: "invoice", label: "Payment reminder" },
};

export const DAILY_CAP = 40; // emails a day, so a mistake or a stranger poking the hub can't flood your clients
export const COOLDOWN_SECONDS = 120; // the same document can't be sent again straight away
export const MAX_DOCS = 6; // quotes/invoices that can go in one email

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
const dayDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }) : "");

// "0424126358" -> "0424 126 358"
const prettyPhone = (p) => String(p).replace(/\D/g, "").replace(/^(\d{4})(\d{3})(\d{3})$/, "$1 $2 $3");

// What the signature says, in plain text (the HTML version adds the logo underneath).
const SIGNATURE = ["Artie Lyons", BIZ.name, prettyPhone(BIZ.phone), BIZ.website];

// -> { subject, text } for one kind of email about one or more quotes/invoices (all for the same client).
// The text is the message only: the sign-off, signature and logo are added when it's sent, so they never need editing.
export function composeEmail(kind, input) {
  const recs = Array.isArray(input) ? input : [input];
  const rec = recs[0];
  const many = recs.length > 1;
  const s = many ? "s" : "";
  const name = first(rec.clientName);
  const hi = `Hi${name ? ` ${name}` : ""},`;

  if (kind === "quote") {
    return {
      subject: `Quote${s} from ${BIZ.name}`,
      text: [hi, `Thank you for the opportunity to quote on your fencing. Please find the quote${s} attached. If you have any questions, or you'd like anything adjusted, just let me know.`].join("\n\n"),
    };
  }
  if (kind === "followup") {
    const when = rec.date ? ` on ${dayDate(rec.date)}` : "";
    return {
      subject: `Following up on your quote${s}`,
      text: [hi, `I just wanted to follow up on the quote${s} I sent through${when}. If you have any questions, or you'd like anything adjusted, please let me know. I'm happy to help.`].join("\n\n"),
    };
  }
  if (kind === "start") {
    const changed = String(rec.lastFollowUp || "").startsWith("start:");
    const date = dayDate(rec.startDate);
    return {
      subject: changed ? "Your start date has changed" : "Your start date",
      text: [
        hi,
        changed
          ? `Just letting you know your start date has changed to ${date}. Sorry for any inconvenience, and please let me know if that doesn't suit.`
          : `Thank you for accepting the quote. I've got you booked in to start on ${date}, and I'll be in touch beforehand if anything changes.`,
      ].join("\n\n"),
    };
  }
  const allDeposit = recs.every((r) => isDepositInvoice(r));
  const what = `${allDeposit ? "deposit invoice" : "invoice"}${s}`;
  if (kind === "invoice") {
    return {
      subject: `${allDeposit ? "Deposit invoice" : "Invoice"}${s} from ${BIZ.name}`,
      text: [
        hi,
        `Please find the ${what} attached, with the payment details included.${allDeposit ? " The deposit is due before works commence." : ""} If you have any questions, just let me know.`,
      ].join("\n\n"),
    };
  }
  // chase
  return {
    subject: `Payment reminder`,
    text: [
      hi,
      `Just a quick reminder that the attached ${what} ${many ? "are" : "is"} still outstanding. The payment details are on the invoice${s}. If you've already paid, please disregard this message, and otherwise let me know if you have any questions.`,
    ].join("\n\n"),
  };
}

const escapeHtml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The logo, as a small image attached inline to the email (shown under the signature, not as a separate attachment).
export const LOGO_CID = "lfs-logo";
export const logoAttachment = () => ({
  filename: "logo.png",
  content: Buffer.from(LOGO_DATA_URI.split(",")[1], "base64"),
  contentType: "image/png",
  cid: LOGO_CID,
  contentDisposition: "inline",
});

// Plain-text and HTML versions of the whole email. The HTML keeps to Gmail's own default look: the usual sans-serif font
// and size, short paragraphs, then the sign-off, signature and the logo with a little room under the name.
export function buildBodies(text) {
  const paragraphs = String(text).trim().split(/\n{2,}/);
  const body = paragraphs.map((p) => `<div style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</div>`).join("");
  const sig = SIGNATURE.map((l, i) => (i === 3 ? `<a href="https://${BIZ.website}" style="color:#555">${escapeHtml(l)}</a>` : escapeHtml(l))).join("<br>");
  const html =
    `<div dir="ltr" style="font-family:arial,helvetica,sans-serif;font-size:small;line-height:1.5">` +
    body +
    `<div style="margin:0 0 4px">Kind regards,</div>` +
    `<div style="color:#555">${sig}</div>` +
    `<div style="margin-top:28px"><img src="cid:${LOGO_CID}" width="220" alt="${escapeHtml(BIZ.name)}" style="display:block;border:0;height:auto"></div>` +
    `</div>`;
  return { text: `${String(text).trim()}\n\nKind regards,\n${SIGNATURE.join("\n")}`, html };
}

export async function sendEmail({ mailer, to, subject, text, attachments = [] }) {
  const bodies = buildBodies(text);
  return mailer.transport.sendMail({
    from: `"Artie Lyons" <${mailer.user}>`,
    replyTo: mailer.user,
    to,
    subject,
    text: bodies.text,
    html: bodies.html,
    attachments: [...attachments, logoAttachment()],
  });
}
