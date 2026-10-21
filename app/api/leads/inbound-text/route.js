// Receives client texts forwarded from the iPhone (a Shortcuts automation posts each incoming message here).
// If the sender's number (or, for a saved contact, exact name) matches a lead, the text is added to that lead's notes and any availability in it
// ("free from 3:30") is picked up for the visit planner. Texts from anyone who isn't a lead are ignored and
// NOT stored — your personal messages never end up in the hub.
// Same shared secret as the phone-agent webhooks (x-api-key = PHONE_AGENT_API_KEY).
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseAvailability, parseNotesAvailability, withAvailability } from "@/lib/availability";

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
  if ((!byName && from.length < 8) || !text) return NextResponse.json({ ok: true, matched: false });

  const { data: leads, error } = await supabaseAdmin.from("leads").select("id,name,phone,notes").order("inserted_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const norm = (s) => String(s || "").replace(/\?/g, "").trim().toLowerCase();
  const named = byName ? (leads || []).filter((l) => norm(l.name) === norm(rawFrom)) : [];
  const lead = byName ? (named.length === 1 ? named[0] : null) : (leads || []).find((l) => tail(l.phone) === from);
  if (!lead) return NextResponse.json({ ok: true, matched: false }); // not a lead: drop it, store nothing

  const clean = text.replace(/\s*\n\s*/g, " ").slice(0, 600);
  const existing = String(lead.notes || "");
  if (existing.includes(clean)) return NextResponse.json({ ok: true, matched: true, duplicate: true, leadId: lead.id });

  let notes = [existing.trim(), `Text ${stamp()}: ${clean}`].filter(Boolean).join("\n");
  const found = parseAvailability(text);
  if (found.notBefore != null || found.notAfter != null) {
    const cur = parseNotesAvailability(existing);
    notes = withAvailability(notes, { notBefore: found.notBefore ?? cur.notBefore, notAfter: found.notAfter ?? cur.notAfter });
  }
  notes = notes.slice(-4000); // keep the newest if a lead ever gets very chatty

  const { error: upErr } = await supabaseAdmin.from("leads").update({ notes }).eq("id", lead.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, matched: true, leadId: lead.id, availability: found });
}
