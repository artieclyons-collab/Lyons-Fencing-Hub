// Tells the hub what to show in its "iPhone calendar" screen: the private feed
// URL for this deployment. Same trust level as the rest of the hub (no login —
// whoever can open the hub can use it), so it hands the link out freely.
import { NextResponse } from "next/server";
import { calendarToken } from "@/lib/calendarFeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const token = calendarToken();
  if (!token) return NextResponse.json({ error: "Not configured" }, { status: 501 });

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const path = `${host}/api/calendar/${token}.ics`;
  return NextResponse.json({ url: `${proto}://${path}`, webcal: `webcal://${path}` });
}
