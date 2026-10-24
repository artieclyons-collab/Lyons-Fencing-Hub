// Receives client texts forwarded from the iPhone (a Shortcuts automation posts each incoming message here).
// If the sender's number (or, for a saved contact, exact name) matches a lead, only the useful part of the text is used:
// an address updates the lead's address, availability ("free from 3:30") updates what the visit planner reads, and a
// cancellation is flagged. The message itself isn't copied into the notes. Texts from anyone who isn't a lead are
// ignored and NOT stored — your personal messages never end up in the hub.
// Same shared secret as the phone-agent webhooks (x-api-key = PHONE_AGENT_API_KEY).
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseAvailability, parseNotesAvailability, withAvailability, detectCancellation } from "@/lib/availability";
import { detectEnquiry, localPhone, extractAddress } from "@/lib/enquiry";
import { detectDecision, decideQuote, saveDecision } from "@/lib/quoteDecision";
import { isPlaceholderName, introducedName, renameClient } from "@/lib/leadName";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req) {
  const expected = process.env.PHONE_AGENT_API_KEY;
  if (!expected) return false;
  const a = Buffer.from(req.headers.get("x-api-key") || "");
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 0412 345 678, +61 412 345 678 and 61412345678 all end in the same nine digits.
const tail = (s) => String(s || "").replace(/\D/g, "").slice(-9);

const stamp = () =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date())
    .replace(",", "")
    .replace(/\s?([ap])m/i, (_, x) => `${x.toLowerCase()}m`);

export async function POST(req) {
  if (!process.env.PHONE_AGENT_API_KEY) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Database not configured" }, { status: 501 });

  const body = await req.json().catch(() => ({}));
  const rawFrom = String(body.from || "").trim();
  const from = tail(rawFrom);
  const text = String(body.text ?? body.message ?? "").trim();
  // iPhone Shortcuts gives a saved contact's NAME instead of the number, so a sender with no digits is matched by exact name.
  const byName = !/\d/.test(rawFrom) && rawFrom.length >= 2;
  if ((!byName && from.length < 8) || !text) {
    // Nothing usable arrived (e.g. a Shortcut variable that came through empty) — say so in the log, never the content.
    console.log(`inbound-text: ignored, nothing usable (from is ${rawFrom.length} chars, text is ${text.length} chars, body keys: ${Object.keys(body).join(",") || "none"})`);
    return NextResponse.json({ ok: true, matched: false });
  }

  const { data: leads, error } = await supabaseAdmin.from("leads").select("id,name,phone,email,address,notes").order("inserted_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Names compare on letters and digits only, so emoji, spacing and punctuation ("Em ❤️" vs "Em") never get in the way.
  const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const named = byName && norm(rawFrom) ? (leads || []).filter((l) => norm(l.name) === norm(rawFrom)) : [];
  const lead = byName ? (named.length === 1 ? named[0] : null) : (leads || []).find((l) => tail(l.phone) === from);
  // Vercel's log shows why a text wasn't matched (never the message, and only the last 3 digits of a number).
  if (!lead) console.log(`inbound-text: no lead for ${byName ? `name "${rawFrom}" (${named.length} matches)` : `number ending ${from.slice(-3)}`}`);

  // An unknown NUMBER (not a saved contact) whose text reads like a fencing enquiry becomes a new lead. A saved contact's
  // name, or a text that doesn't mention fencing or a quote, is treated as personal: dropped, nothing stored.
  if (!lead && !byName) {
    const enq = detectEnquiry(text);
    if (!enq.isEnquiry) return NextResponse.json({ ok: true, matched: false });
    const phone = localPhone(rawFrom);
    const clean = text.replace(/\s*\n\s*/g, " ").slice(0, 600);
    let notes = `Text ${stamp()}: ${clean}`;
    const found = parseAvailability(text);
    if (found.notBefore != null || found.notAfter != null) notes = withAvailability(notes, found);
    const row = {
      // One lead per number: a second text arriving at the same moment (or a second automation) can't make a duplicate.
      id: `txt${from}`,
      name: enq.name || `Enquiry ${phone}`,
      phone,
      email: null,
      address: enq.address || "",
      jobType: enq.jobType,
      status: "New",
      notes,
      createdAt: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date()),
      source: "text",
    };
    const { error: insErr } = await supabaseAdmin.from("leads").upsert(row, { onConflict: "id", ignoreDuplicates: true });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    console.log(`inbound-text: new lead created from a text (number ending ${from.slice(-3)})`);
    return NextResponse.json({ ok: true, matched: false, created: true, leadId: row.id });
  }
  if (!lead) return NextResponse.json({ ok: true, matched: false }); // not a lead: drop it, store nothing

  // A text from a lead only changes what matters. The message itself is NOT copied into their notes:
  //   - an address        -> the lead's address
  //   - availability      -> the "Available from…" line the planner reads
  //   - a cancellation, or a request to move the visit -> kept as a short record, so the planner can flag it
  //   - anything else ("ok thanks", "see you then") -> ignored
  const clean = text.replace(/\s*\n\s*/g, " ").slice(0, 600);
  const existing = String(lead.notes || "");
  const patch = {};
  const applied = [];
  let notes = existing;

  // A lead with no name yet ("N/A") whose text says who they are ("it's Chen") gets their name.
  if (isPlaceholderName(lead.name)) {
    const who = introducedName(text);
    if (who) {
      patch.name = who;
      applied.push("name");
      await renameClient(supabaseAdmin, lead, who);
    }
  }

  // "Yep go ahead" / "we've gone with someone else": moves their one sent quote to Accepted / Declined (see lib/quoteDecision.js).
  let decided = false;
  if (detectDecision(text)) {
    const { data: quoteRows } = await supabaseAdmin.from("quotes").select("id,docNumber,clientName,clientPhone,clientEmail,status");
    const dec = decideQuote({ lead, quotes: quoteRows || [], text, via: "text" });
    if (dec && !dec.ambiguous && (await saveDecision(supabaseAdmin, dec))) {
      decided = true;
      patch.status = dec.leadPatch.status;
      notes = [notes.trim(), dec.noteLine].filter(Boolean).join("\n");
      applied.push(`quote ${dec.decision === "accept" ? "accepted" : "declined"}`);
    }
  }

  const addr = extractAddress(text);
  if (addr) {
    const cur = String(lead.address || "").trim();
    if (norm(cur) !== norm(addr.full)) {
      patch.address = addr.full;
      applied.push("address");
      // Replacing a full street address is worth a trace; filling in a bare suburb is not.
      if (/\d/.test(cur)) notes = [notes.trim(), "Address changed by text (was: " + cur + ")."].filter(Boolean).join("\n");
    }
  }

  const found = parseAvailability(text);
  if (found.notBefore != null || found.notAfter != null) {
    const cur = parseNotesAvailability(existing);
    const withNew = withAvailability(notes, { notBefore: found.notBefore ?? cur.notBefore, notAfter: found.notAfter ?? cur.notAfter });
    if (withNew !== notes) {
      notes = withNew;
      applied.push("availability");
    }
  }

  const mood = detectCancellation(text);
  if (!decided && (mood.cancelled || mood.reschedule) && !existing.includes(clean)) {
    notes = [notes.trim(), "Text " + stamp() + ": " + clean].filter(Boolean).join("\n");
    applied.push(mood.cancelled ? "possible cancellation" : "request to move the visit");
  }

  if (applied.length === 0) return NextResponse.json({ ok: true, matched: true, ignored: true, leadId: lead.id });

  if (notes !== existing) patch.notes = notes.slice(-4000); // keep the newest if a lead ever gets very chatty
  const { error: upErr } = await supabaseAdmin.from("leads").update(patch).eq("id", lead.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, matched: true, leadId: lead.id, applied });
}
