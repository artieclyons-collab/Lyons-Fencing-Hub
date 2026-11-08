// "Send me a test alert": checks phone alerts work end to end. Only the hub's own pages may call it.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendPush, pushConfigured } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  let ok = false;
  try { ok = origin ? new URL(origin).host === host : req.headers.get("sec-fetch-site") === "same-origin"; } catch { ok = false; }
  if (!ok) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!pushConfigured() || !supabaseAdmin) return NextResponse.json({ error: "Phone alerts aren't set up on the server yet." }, { status: 501 });
  const r = await sendPush(supabaseAdmin, { title: "Lyons Fencing Hub", body: "Phone alerts are on. You'll get one when a new lead comes in.", tag: "test", url: "/" });
  return NextResponse.json(r);
}
