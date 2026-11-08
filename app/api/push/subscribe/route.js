// A phone turning phone alerts on or off: GET says whether alerts are set up on the server, POST saves this phone's subscription,
// DELETE removes it. Only the hub's own pages may call it.
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { pushConfigured } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sameOrigin = (req) => {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin) { try { return new URL(origin).host === host; } catch { return false; } }
  return req.headers.get("sec-fetch-site") === "same-origin";
};
const idFor = (endpoint) => `push-${crypto.createHash("sha1").update(endpoint).digest("hex").slice(0, 20)}`;

export async function GET() {
  return NextResponse.json({ configured: pushConfigured() && !!supabaseAdmin, publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || "" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!pushConfigured() || !supabaseAdmin) return NextResponse.json({ error: "Phone alerts aren't set up on the server yet." }, { status: 501 });
  const { subscription } = await req.json().catch(() => ({}));
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return NextResponse.json({ error: "That isn't a push subscription." }, { status: 400 });
  const { error } = await supabaseAdmin.from("expenses").upsert({ id: idFor(subscription.endpoint), category: "System", description: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }), amount: "0", date: new Date().toISOString().slice(0, 10) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const { endpoint } = await req.json().catch(() => ({}));
  if (endpoint && supabaseAdmin) await supabaseAdmin.from("expenses").delete().eq("id", idFor(endpoint));
  return NextResponse.json({ ok: true });
}
