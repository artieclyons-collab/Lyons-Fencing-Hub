import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { BUCKET, KINDS, ensureBucket, listPhotos, getSignoff, safeId } from "@/lib/jobPhotos";

// The hub's side of job photos (behind the hub password): list a quote's photos with short-lived links, add one, delete one.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Database not configured" }, { status: 501 });
  try {
    const quote = safeId(new URL(req.url).searchParams.get("quote"));
    if (!quote) return NextResponse.json({ error: "Missing quote" }, { status: 400 });
    const [photos, signoff] = await Promise.all([listPhotos(supabaseAdmin, quote), getSignoff(supabaseAdmin, quote)]);
    return NextResponse.json({ photos, signoff });
  } catch (e) {
    console.log("photos list failed —", String(e?.message || e).slice(0, 140));
    return NextResponse.json({ error: "Couldn't load the photos." }, { status: 500 });
  }
}

export async function POST(req) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Database not configured" }, { status: 501 });
  try {
    const { quoteId, kind, base64, mediaType } = await req.json();
    const id = safeId(quoteId);
    if (!id || !base64) return NextResponse.json({ error: "Missing photo" }, { status: 400 });
    const buf = Buffer.from(String(base64), "base64");
    if (buf.length < 500 || buf.length > 3.5 * 1024 * 1024) return NextResponse.json({ error: "That photo is too big or empty." }, { status: 400 });
    await ensureBucket(supabaseAdmin);
    const k = KINDS.includes(kind) ? kind : "other";
    const path = `${id}/${k}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
    const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: mediaType === "image/png" ? "image/png" : "image/jpeg", upsert: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, path });
  } catch (e) {
    console.log("photo upload failed —", String(e?.message || e).slice(0, 140));
    return NextResponse.json({ error: "Couldn't save that photo." }, { status: 500 });
  }
}

export async function DELETE(req) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Database not configured" }, { status: 501 });
  try {
    const { path } = await req.json();
    const p = String(path || "");
    if (!/^[A-Za-z0-9_-]+\/(?:before|after|other)-\d+-[a-z0-9]+\.(?:jpg|png)$/.test(p)) return NextResponse.json({ error: "Bad path" }, { status: 400 });
    const { error } = await supabaseAdmin.storage.from(BUCKET).remove([p]);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.log("photo delete failed —", String(e?.message || e).slice(0, 140));
    return NextResponse.json({ error: "Couldn't delete that photo." }, { status: 500 });
  }
}
