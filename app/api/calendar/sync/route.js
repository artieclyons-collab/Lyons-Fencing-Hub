// Two-way sync between the hub and a Google Calendar (which the iPhone Calendar app syncs with, both ways).
//   GET  -> is it set up? (add ?check=1 to also test the connection)
//   POST -> run one sync round: push hub changes to Google, bring phone changes back into the hub.
// Safe to call as often as you like (it only does what's different), so the hub calls it while open.
// Needs GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_CALENDAR_ID (see the README).
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { scheduleEvents } from "@/lib/schedule";
import { loadCredentials, createGoogleClient } from "@/lib/googleCalendar";
import { runSync } from "@/lib/googleSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { headers: { "Cache-Control": "no-store" } };
// Only these can be changed in the hub by a calendar edit.
const ALLOWED = { quotes: ["startDate"], leads: ["visitDate", "visitTime"], invoices: ["dueDate"] };

const todayBrisbane = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date());

function client() {
  const credentials = loadCredentials();
  if (!credentials) return null;
  return { credentials, google: createGoogleClient({ credentials, calendarId: process.env.GOOGLE_CALENDAR_ID, apiBase: process.env.GOOGLE_API_BASE || undefined, tokenUrl: process.env.GOOGLE_TOKEN_URL || undefined }) };
}

let running = null; // one round at a time on this server

export async function GET(req) {
  const c = client();
  if (!c) return NextResponse.json({ configured: false }, NO_STORE);
  const out = { configured: true, serviceAccount: c.credentials.client_email };
  if (new URL(req.url).searchParams.get("check")) {
    try {
      Object.assign(out, { connected: true, ...(await c.google.check()) });
    } catch (e) {
      Object.assign(out, { connected: false, error: e.message });
    }
  }
  return NextResponse.json(out, NO_STORE);
}

export async function POST() {
  const c = client();
  if (!c) return NextResponse.json({ configured: false }, NO_STORE);
  if (!supabaseAdmin) return NextResponse.json({ error: "Database not configured" }, { status: 501 });
  if (running) return NextResponse.json({ configured: true, busy: true }, NO_STORE);

  running = (async () => {
    const [leads, quotes, invoices] = await Promise.all(["leads", "quotes", "invoices"].map((t) => supabaseAdmin.from(t).select("*")));
    const failed = [leads, quotes, invoices].find((r) => r.error);
    if (failed) throw new Error(`Couldn't read the hub's data: ${failed.error.message}`);
    const desired = scheduleEvents({ leads: leads.data || [], quotes: quotes.data || [], invoices: invoices.data || [] });
    return runSync({
      desired,
      today: todayBrisbane(),
      client: c.google,
      applyHubUpdate: async ({ table, id, fields }) => {
        const okFields = ALLOWED[table];
        if (!okFields || Object.keys(fields).some((k) => !okFields.includes(k))) throw new Error(`Not allowed to change ${table}`);
        const { error } = await supabaseAdmin.from(table).update(fields).eq("id", id);
        if (error) throw new Error(error.message);
      },
    });
  })();

  try {
    return NextResponse.json({ configured: true, ...(await running) }, NO_STORE);
  } catch (e) {
    return NextResponse.json({ configured: true, error: e.message }, { status: 500 });
  } finally {
    running = null;
  }
}
