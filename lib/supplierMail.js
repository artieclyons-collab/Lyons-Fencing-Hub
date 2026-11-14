// Supplier invoices that arrive by email (Our Town sends theirs to a personal Gmail that forwards to the business one; a Bunnings receipt
// is shared from the PowerPass app by email). The inbox reader (app/api/leads/inbox) picks out emails with a PDF or photo that look like
// supplier invoices, Claude reads each one, and it waits on the Finances tab as "From your email: check these" with the job suggested.
// Nothing counts towards a job until you confirm it there. Waiting items are rows in the expenses table (category "System", id "pend-…").
import crypto from "node:crypto";
import { readInvoiceBase64 } from "./readInvoiceAi";
import { supplierId } from "./supplierInvoice";

// (isPendingRow / pendingFromRow live in lib/supplierInvoice.js so the Finances screen can use them too)

const SUPPLIERS = /our\s*town|ourtown|bunnings|rapidfence|oxworks|stratco|reece|sunstate|total\s*tools/i;
const NOT_SUPPLIERS = /vercel|anthropic|stripe|hipages|github|netflix|paypal|uber|linkedin|facebook|supabase|openai|zapier|cron-job|apple\.com|microsoft/i;
const PAPER = /invoice|receipt/i;
// The labourer's own invoice to Lyons Fencing (he emails it back) is not a supplier bill: it's tracked under Labourer invoices.
const LABOURER_MAIL = /usher|oakenfull/i;
const ATTACHABLE = /^(?:application\/pdf|image\/(?:jpeg|jpg|png|heic|heif|webp))$/i;

// the attachments (name, type) described by a message's body structure, without downloading it
export function attachmentsOf(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node.childNodes)) for (const c of node.childNodes) attachmentsOf(c, out);
  else {
    const type = String(node.type || "").toLowerCase();
    const filename = node.dispositionParameters?.filename || node.parameters?.name || "";
    if (ATTACHABLE.test(type) && (node.disposition === "attachment" || filename)) out.push({ filename, type });
  }
  return out;
}

// Anything from a supplier's own address is never a customer enquiry (even the emails that aren't invoices, like orders).
export const isSupplierSender = ({ address = "", display = "" }) => SUPPLIERS.test(`${address} ${display}`);

// From the envelope alone: could this be a supplier invoice or receipt?
export function looksLikeSupplierMail({ address = "", display = "", subject = "", attachments = [] }) {
  if (!attachments.length) return false;
  const who = `${address} ${display}`;
  if (NOT_SUPPLIERS.test(who)) return false;
  if (LABOURER_MAIL.test(`${who} ${subject} ${attachments.map((a) => a.filename).join(" ")}`)) return false;
  // Our Town also sends "Payment Receipt 4107539 for Document 6387197" (the payment for an invoice already counted) and "Order 6382484"
  // (only an order): neither is the invoice, so counting them would double up or count something not yet supplied.
  if (/payment\s+receipt/i.test(subject)) return false;
  if (/\border\s+#?\d+/i.test(subject) && !/invoice/i.test(subject)) return false;
  const names = attachments.map((a) => a.filename).join(" ");
  const text = `${who} ${subject} ${names}`;
  return SUPPLIERS.test(text) || PAPER.test(`${subject} ${names}`);
}

const hash = (s) => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 16);

// mails: [{ key, messageId, subject, display, address, receivedAt, attachments: [{ filename, mediaType, base64 }] }]
// Reads each attachment and queues what's a real tax invoice. Returns { queued: [{ supplier, total }], handled: [mail keys finished with] }.
// A mail is "finished with" unless reading failed in a way that's worth retrying (the AI being unreachable).
export async function importSupplierMails(db, mails) {
  const queued = [];
  const handled = [];
  if (!process.env.ANTHROPIC_API_KEY) return { queued, handled };
  const { data: have } = await db.from("expenses").select("id").or("id.like.sup-%,id.like.pend-%");
  const ids = new Set((have || []).map((r) => r.id));
  for (const mail of mails) {
    let retry = false;
    for (const a of mail.attachments) {
      try {
        const doc = await readInvoiceBase64({ base64: a.base64, mediaType: a.mediaType });
        if (LABOURER_MAIL.test(`${doc.supplier || ""}`)) continue; // read as his invoice after all (e.g. a photo with no name on the email)
        if (doc.isOrderOnly || !(doc.totalIncGst > 0) || !(doc.supplier || doc.invoiceNumber)) continue;
        if (doc.invoiceNumber && ids.has(supplierId(doc))) continue; // already added
        const id = `pend-${hash(doc.invoiceNumber ? `${doc.supplier}|${doc.invoiceNumber}` : `${mail.key}|${a.filename}`)}`;
        if (ids.has(id)) continue;
        ids.add(id);
        const row = {
          id,
          category: "System",
          description: JSON.stringify({ v: 1, doc, from: mail.display || mail.address || "", subject: mail.subject || "", file: a.filename || "", receivedAt: new Date(mail.receivedAt).toISOString() }),
          amount: String(doc.totalIncGst),
          date: doc.date || new Date(mail.receivedAt).toISOString().slice(0, 10),
        };
        const { error } = await db.from("expenses").upsert(row);
        if (error) throw new Error(error.message);
        queued.push({ supplier: doc.supplier || mail.display || "Supplier", total: doc.totalIncGst });
      } catch (e) {
        const status = e?.status;
        // not JSON / couldn't make sense of it: don't try this one again. Network, rate limit or key trouble: try again next time.
        if (!(e instanceof SyntaxError) && !(status && status >= 400 && status < 500 && status !== 429 && status !== 401)) retry = true;
        console.log("supplier mail: couldn't read an attachment —", String(e?.message || e).slice(0, 100));
      }
    }
    if (!retry) handled.push(mail.key);
  }
  return { queued, handled };
}
