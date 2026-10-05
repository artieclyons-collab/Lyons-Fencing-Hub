// The calendar feed your iPhone subscribes to. The URL contains a private token
// (see lib/calendarFeed.js) — wrong token gets a plain 404, not a hint that it exists.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildCalendarFeed, calendarToken, tokenMatches } from "@/lib/calendarFeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req, { params }) {
  if (!calendarToken() || !supabaseAdmin) {
    return NextResponse.json({ error: "Not configured" }, { status: 501 });
  }
  const { token } = await params;
  if (!tokenMatches(String(token).replace(/\.ics$/i, ""))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [leads, quotes, invoices] = await Promise.all(
    ["leads", "quotes", "invoices"].map((t) => supabaseAdmin.from(t).select("*"))
  );
  const failed = [leads, quotes, invoices].find((r) => r.error);
  if (failed) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  const ics = buildCalendarFeed({ leads: leads.data, quotes: quotes.data, invoices: invoices.data });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="lyons-fencing-hub.ics"',
      "Cache-Control": "no-store",
    },
  });
}
