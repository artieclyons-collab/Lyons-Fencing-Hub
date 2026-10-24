// Turns enquiry emails in the business inbox into leads (and applies a client's replies to the lead they belong to).
// Pure logic, no network: the route (app/api/leads/inbox) reads the mailbox and calls these.
//
// Deliberately cautious, like the text version: an email only becomes a NEW lead when it is the first message of a conversation
// (not a reply), is from a person rather than a mailing list or a robot, reads like a fencing enquiry, and says where (a suburb or
// street) or how to reach them (a phone number). Everything else is ignored, and the email itself is never stored whole — only a
// short cleaned-up version of what the client wrote, with the quoted history and signatures stripped.
import { detectEnquiry, extractAddress, localPhone } from "./enquiry";
import { parseAvailability, parseNotesAvailability, withAvailability, detectCancellation } from "./availability";
import { BIZ } from "./constants";

const tail = (s) => String(s || "").replace(/\D/g, "").slice(-9);

// Header block (as the raw text IMAP gives it) -> { name: value } with lower-case names.
export function headerMap(raw) {
  const out = {};
  const unfolded = String(raw || "").replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

const ROBOT = /^(?:no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|notifications?|alerts?|news(?:letter)?|marketing|bounce[s]?|automated|billing|accounts?|orders?|receipts?|system|updates?)\b/i;
const HIPAGES = /(?:^|\.)hipages\.com\.au$/i;
const SPAM = /\b(?:seo|backlinks?|guest post|web ?(?:site )?design|google (?:ranking|rankings|maps)|digital marketing|lead generation|crypto|bitcoin|loan offer|verify your|click here|unsubscribe|your invoice|payment (?:received|confirmation)|order confirmation)\b/i;

// What kind of email is this, going by its envelope and headers alone (before downloading the whole message)?
//   "hipages" -> a hipages email (handled by lib/hipages.js)      "client" -> might be from a person       null -> ignore
export function classify({ address, subject, headers = {}, self = "" }) {
  const addr = String(address || "").toLowerCase();
  const [local = "", domain = ""] = addr.split("@");
  if (!addr || !domain) return null;
  if (HIPAGES.test(domain)) return "hipages";
  if (self && addr === String(self).toLowerCase()) return null;
  if (ROBOT.test(local)) return null;
  if (headers["list-unsubscribe"] || headers["list-id"]) return null;
  if (/^(?:bulk|list|junk)$/i.test(headers.precedence || "")) return null;
  const auto = headers["auto-submitted"];
  if (auto && !/^no$/i.test(auto)) return null;
  if (/^\s*(?:out of office|automatic reply|undeliverable|delivery status)/i.test(subject || "")) return null;
  return "client";
}

// Is this message part of a conversation already under way (a reply, or one that quotes an earlier email)?
export const isReply = ({ subject, headers = {} }) => !!(headers["in-reply-to"] || headers.references) || /^\s*(?:re|fwd?)\s*:/i.test(subject || "");

// The new part of an email: quoted history ("On … wrote:", "> …", forwarded blocks) and phone-app signatures removed.
export function cleanBody(text) {
  const lines = String(text || "").replace(/\r/g, "").replace(/[​-‍﻿]/g, "").split("\n");
  const kept = [];
  for (const line of lines) {
    if (/^\s*(?:on\s.+\bwrote:?|on\s.+,\s*at\s.+\bwrote:?)\s*$/i.test(line)) break;
    if (/^\s*on\s.{5,80}$/i.test(line) && kept.length && /wrote:?\s*$/i.test(`${line} `)) break;
    if (/^\s*-{2,}\s*(?:original message|forwarded message)/i.test(line)) break;
    if (/^\s*(?:from|sent):\s.+/i.test(line) && kept.length > 2) break;
    if (/^\s*>/.test(line)) continue;
    if (/^\s*(?:sent from my .+|get outlook for .+|sent from (?:mail|yahoo mail|outlook).*)\s*$/i.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// A phone number written in the message (not the business's own). -> "0472529008" or ""
export function findPhone(text) {
  const re = /(?:\+?61[\s-]?|0)[2-478](?:[\s-]?\d){8}/g;
  for (const m of String(text || "").matchAll(re)) {
    const p = localPhone(m[0]);
    if (p.length === 10 && tail(p) !== tail(BIZ.phone)) return p;
  }
  return "";
}

const GENERIC_NAMES = /^(?:bigpond|gmail|hotmail|outlook|yahoo|icloud|telstra|optus|admin|info|mail|email|contact|sales|enquiries|office|me|user|unknown)$/i;
const titleWord = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

// Who is writing? Preferred: how they signed off ("Many thanks\nSelena"), then the name on the email, then the part before the @.
export function guessName({ display, body, address }) {
  const sign = /(?:^|\n)\s*(?:many thanks|thanks(?: so much| again)?|thank you|kind regards|regards|cheers|best regards|warm regards|sincerely|yours sincerely|best|thanks and regards)[,.!]*\s*\n+\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*(?:\n|$)/i.exec(String(body || ""));
  if (sign && !GENERIC_NAMES.test(sign[1]) && !/^(?:sent|from|phone|mobile|ph|regards|thanks)\b/i.test(sign[1])) return sign[1].split(/\s+/).map(titleWord).join(" ");
  const d = String(display || "").replace(/["<>]/g, "").trim();
  if (d && !d.includes("@") && !GENERIC_NAMES.test(d) && d.split(/\s+/).length <= 4) return d.split(/\s+/).map(titleWord).join(" ");
  const local = String(address || "").split("@")[0].replace(/\d+/g, "").replace(/^(?:ms|mr|mrs|miss|dr)[._-]/i, "");
  const bits = local.split(/[._-]+/).filter((b) => b.length > 1);
  return bits.length ? bits.slice(0, 2).map(titleWord).join(" ") : "";
}

const stampOf = (d) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
    .format(d)
    .replace(",", "")
    .replace(/\s?([ap])m/i, (_, x) => `${x.toLowerCase()}m`);
const brisbaneDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(d);

// A first email from someone new -> a lead row, or null when it doesn't read like an enquiry.
export function leadFromEmail({ display, address, subject, text, receivedAt = new Date() }) {
  const body = cleanBody(text);
  if (!body || body.length > 3000) return null;
  const whole = `${subject || ""}\n${body}`;
  if (SPAM.test(whole)) return null;
  const enq = detectEnquiry(whole);
  if (!enq.isEnquiry) return null;
  const phone = findPhone(body);
  const addr = extractAddress(body);
  const located = !!(addr || enq.address);
  if (!located && !phone) return null;
  const email = String(address).toLowerCase();
  const name = guessName({ display, body, address }) || `Enquiry ${phone || email}`;
  const clean = body.replace(/\s*\n\s*/g, " ").slice(0, 700);
  let notes = `Text ${stampOf(receivedAt)} (email): ${clean}`;
  const found = parseAvailability(body);
  if (found.notBefore != null || found.notAfter != null) notes = withAvailability(notes, found);
  const idTail = tail(phone).length === 9 ? tail(phone) : email.replace(/[^a-z0-9]/g, "").slice(0, 24);
  return {
    id: `eml${idTail}`,
    name,
    phone,
    email,
    address: addr?.full || enq.address || "",
    jobType: enq.jobType,
    status: "New",
    notes,
    createdAt: brisbaneDay(receivedAt),
    source: "email",
  };
}

// A client's message (reply or follow-up) -> { patch, applied[] } to change on the lead they belong to, or null when it changes nothing.
// Same rules as the forwarded texts: an address updates the address, "free from 3:30" updates what the planner reads, a cancellation
// or a request to move the visit is kept as a short record. Anything else ("ok thanks") is ignored.
export function applyClientMessage(lead, text, receivedAt = new Date()) {
  const body = cleanBody(text);
  if (!body) return null;
  const clean = body.replace(/\s*\n\s*/g, " ").slice(0, 600);
  const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const existing = String(lead.notes || "");
  let notes = existing;
  const patch = {};
  const applied = [];

  const addr = extractAddress(body);
  if (addr) {
    const cur = String(lead.address || "").trim();
    if (norm(cur) !== norm(addr.full)) {
      patch.address = addr.full;
      applied.push("address");
      if (/\d/.test(cur)) notes = [notes.trim(), `Address changed by email (was: ${cur}).`].filter(Boolean).join("\n");
    }
  }
  const found = parseAvailability(body);
  if (found.notBefore != null || found.notAfter != null) {
    const cur = parseNotesAvailability(existing);
    const withNew = withAvailability(notes, { notBefore: found.notBefore ?? cur.notBefore, notAfter: found.notAfter ?? cur.notAfter });
    if (withNew !== notes) { notes = withNew; applied.push("availability"); }
  }
  const mood = detectCancellation(body);
  if ((mood.cancelled || mood.reschedule) && !existing.includes(clean)) {
    notes = [notes.trim(), `Text ${stampOf(receivedAt)} (email): ${clean}`].filter(Boolean).join("\n");
    applied.push(mood.cancelled ? "possible cancellation" : "request to move the visit");
  }
  if (!applied.length) return null;
  if (notes !== existing) patch.notes = notes.slice(-4000);
  return { patch, applied };
}

// Which existing lead does this email belong to? By the sender's address, then by a phone number written in the message.
export function matchLead(leads, { address, text }) {
  const email = String(address || "").trim().toLowerCase();
  const byEmail = email ? leads.find((l) => String(l.email || "").trim().toLowerCase() === email) : null;
  if (byEmail) return byEmail;
  const p = tail(findPhone(cleanBody(text)));
  return p.length === 9 ? leads.find((l) => tail(l.phone) === p) || null : null;
}
