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
import { foldUpdate } from "@/lib/noteSummary";
import { isPlaceholderName, introducedName, renameClient } from "@/lib/leadName";
import { relevantParts } from "@/lib/relevant";
import { clientFromQuotes, clientFromQuotesByName, asksForNewWork, matchContact } from "@/lib/leadQuotes";
import { sendPush } from "@/lib/push";
import { detectBillTo, getBillTo, setBillTo, mentionsOtherHousehold } from "@/lib/billTo";
import { SYSTEM_CATEGORY, TEXT_IN_ID } from "@/lib/systemRows";

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

// Remembers that the phone got a text through (or that one arrived with nothing usable in it), so the Board can show whether the
// Shortcut is reaching the hub. Never stores anything from the message itself.
async function noteArrival(usable) {
  try {
    const { data } = await supabaseAdmin.from("expenses").select("description").eq("id", TEXT_IN_ID).maybeSingle();
    let state = {};
    try { state = JSON.parse(data?.description || "{}") || {}; } catch { /* start again */ }
    const now = new Date().toISOString();
    if (usable) state.last = now; else state.empty = now;
    state.n = (Number(state.n) || 0) + 1;
    await supabaseAdmin.from("expenses").upsert({ id: TEXT_IN_ID, category: SYSTEM_CATEGORY, description: JSON.stringify(state), amount: "0", date: now.slice(0, 10) });
  } catch (e) {
    console.log("inbound-text: couldn't note the arrival —", String(e?.message || e).slice(0, 120));
  }
}

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
  await noteArrival(!((!byName && from.length < 8) || !text));
  if ((!byName && from.length < 8) || !text) {
    // Nothing usable arrived (e.g. a Shortcut variable that came through empty) — say so in the log, never the content.
    console.log(`inbound-text: ignored, nothing usable (from is ${rawFrom.length} chars, text is ${text.length} chars, body keys: ${Object.keys(body).join(",") || "none"})`);
    return NextResponse.json({ ok: true, matched: false });
  }

  const { data: leads, error } = await supabaseAdmin.from("leads").select("id,name,phone,email,address,notes,status").order("inserted_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Names compare on letters and digits only, so emoji, spacing and punctuation ("Em ❤️" vs "Em") never get in the way.
  const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const named = byName && norm(rawFrom) ? (leads || []).filter((l) => norm(l.name) === norm(rawFrom)) : [];
  // (a saved contact is usually "Name Suburb", so a name that isn't exact still finds the lead when the extra words are in their name or address)
  const lead = byName ? (named.length === 1 ? named[0] : matchContact(rawFrom, (leads || []).map((l) => ({ name: l.name, place: l.address, ref: l }))) ?.ref || null) : (leads || []).find((l) => tail(l.phone) === from);
  // Vercel's log shows why a text wasn't matched (never the message, and only the last 3 digits of a number).
  if (!lead) console.log(`inbound-text: no lead for ${byName ? `name "${rawFrom}" (${named.length} matches)` : `number ending ${from.slice(-3)}`}`);

  // An unknown NUMBER (not a saved contact) whose text reads like a fencing enquiry becomes a new lead. A saved contact's
  // name, or a text that doesn't mention fencing or a quote, is treated as personal: dropped, nothing stored.
  if (!lead) {
    // A number (or a saved contact's name) that belongs to a client with a quote (someone who's accepted, say) is that client, not a new
    // enquiry. If they're asking for new work ("can you quote 2 fence post replacements") it becomes a New lead under their own name, with
    // the request as site notes so Start quote can read it. Anything else they say is kept, in short, on a lead under their own name.
    const { data: qrows } = await supabaseAdmin.from("quotes").select("id,docNumber,clientName,clientPhone,clientEmail,address,suburb,jobType,status,date");
    const { data: irows } = await supabaseAdmin.from("invoices").select("id,quoteId,clientEmail,address,suburb");
    const client = byName ? clientFromQuotesByName(qrows || [], rawFrom, irows || []) : clientFromQuotes(qrows || [], { phone: rawFrom }, irows || []);
    if (client) {
      const rel = relevantParts(text, { max: 700 });
      if (!rel) return NextResponse.json({ ok: true, matched: false, client: true });
      const phone = localPhone(client.phone || rawFrom);
      const newWork = asksForNewWork(text); // (not just mentioning the fence: "it looks great" from a happy client isn't a new job)
      const enq = newWork ? detectEnquiry(text) : {};
      const row = {
        id: `txt${tail(phone) || from}`,
        name: client.name || `Client ${phone}`,
        phone,
        email: client.email || null,
        address: enq.address || client.address || "",
        jobType: newWork ? (enq.jobType && enq.jobType !== "Other" ? enq.jobType : /post|repair|fix|replac/i.test(text) ? "Repairs" : client.jobType || "Other") : client.jobType || "Other",
        status: newWork ? "New" : client.status,
        notes: newWork ? rel.replace(/\s*\n\s*/g, " ") : `Text ${stamp()}: ${rel.replace(/\s*\n\s*/g, " ")}`,
        createdAt: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date()),
        source: "text",
      };
      const { error: cErr } = await supabaseAdmin.from("leads").upsert(row, { onConflict: "id", ignoreDuplicates: true });
      if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
      console.log(`inbound-text: a client's text kept on a lead under their own name${newWork ? " (a new request)" : ""}`);
      if (newWork) { try { await sendPush(supabaseAdmin, { title: `New request: ${row.name}`, body: rel.slice(0, 120), tag: `lead-${row.id}`, url: "/" }); } catch {} }
      return NextResponse.json({ ok: true, matched: false, created: true, client: true, newWork, leadId: row.id });
    }
  }
  if (!lead && !byName) {
    const enq = detectEnquiry(text);
    if (!enq.isEnquiry) return NextResponse.json({ ok: true, matched: false });
    const phone = localPhone(rawFrom);
    const clean = text.replace(/\s*\n\s*/g, " ").slice(0, 600);
    // Only the details that matter, in plain site-notes style (no "Text …" prefix) so Start quote can read them.
    let notes = relevantParts(text, { max: 700 }) || clean.slice(0, 200);
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
    try { await sendPush(supabaseAdmin, { title: `New enquiry: ${row.name}`, body: [row.address, notes].filter(Boolean).join(" · ").slice(0, 120), tag: `lead-${row.id}`, url: "/" }); } catch {}
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

  // A lead that was quoted, won or lost and now asks for new work comes back as New (so it shows on the Board and buzzes the phone).
  if (["Quoted", "Won", "Lost"].includes(lead.status) && asksForNewWork(text)) {
    patch.status = "New";
    patch.createdAt = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date());
    applied.push("new request");
    try { await sendPush(supabaseAdmin, { title: `New request: ${lead.name}`, body: text.replace(/\s+/g, " ").slice(0, 120), tag: `lead-${lead.id}`, url: "/" }); } catch {}
  }

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

  // "Can you put Gooding Drive Villas CTS 38702 in the invoice, it's required by the body corporate": quotes and invoices are made out to that
  const billTo = detectBillTo(text);
  if (billTo && getBillTo(notes) !== billTo) {
    notes = setBillTo(notes, billTo);
    applied.push("bill to");
  }

  const addr = mentionsOtherHousehold(text) ? null : extractAddress(text); // (an address in a message about the neighbour isn't this client's)
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

  // Anything else worth keeping (a new detail, a change, access info) as a short record, not the whole message.
  if (!decided && !applied.some((a) => /cancellation|move the visit/.test(a))) {
    // Folded into one running "Updates" line (see lib/noteSummary.js), not added as a line of its own.
    const rel = relevantParts(text, { max: 320 });
    if (rel) {
      const folded = await foldUpdate(notes, { text: rel, when: stamp().split(" ").slice(0, 2).join(" ") });
      if (folded !== notes) {
        notes = folded;
        applied.push("details");
      }
    }
  }

  if (applied.length === 0) return NextResponse.json({ ok: true, matched: true, ignored: true, leadId: lead.id });

  if (notes !== existing) patch.notes = notes.slice(-4000); // keep the newest if a lead ever gets very chatty
  const { error: upErr } = await supabaseAdmin.from("leads").update(patch).eq("id", lead.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, matched: true, leadId: lead.id, applied });
}
