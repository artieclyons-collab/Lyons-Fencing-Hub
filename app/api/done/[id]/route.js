import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { listPhotos, getSignoff, SIGNOFF_PREFIX, safeId } from "@/lib/jobPhotos";
import { sendPush } from "@/lib/push";

// Public, no login (like the quote accept page): the client opens the link from your text, looks at the before and after photos, and confirms the
// work is finished. Only the before and after photos are shown, only for that one quote, and only through links that expire in an hour.
// POST records the sign-off once; it can't change anything else.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req, { params }) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const id = safeId((await params).id);
  const { data } = await supabaseAdmin.from("quotes").select("clientName,address,suburb,docNumber,status").eq("id", id).limit(1);
  const q = data?.[0];
  if (!q || q.status !== "Accepted") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [photos, signoff] = await Promise.all([listPhotos(supabaseAdmin, id, { kinds: ["before", "after"] }), getSignoff(supabaseAdmin, id)]);
  return NextResponse.json({
    client: String(q.clientName || "").split(/\s+/)[0] || "",
    place: [q.address, q.suburb].filter(Boolean).join(", "),
    photos: photos.map((p) => ({ kind: p.kind, url: p.url })),
    signoff: signoff ? { name: signoff.name, at: signoff.at } : null,
  });
}

export async function POST(req, { params }) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const id = safeId((await params).id);
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "Please type your name" }, { status: 400 });
  const { data } = await supabaseAdmin.from("quotes").select("clientName,docNumber,status").eq("id", id).limit(1);
  const q = data?.[0];
  if (!q || q.status !== "Accepted") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (await getSignoff(supabaseAdmin, id)) return NextResponse.json({ ok: true, already: true });
  const at = new Date().toISOString();
  const { error } = await supabaseAdmin.from("expenses").upsert({ id: `${SIGNOFF_PREFIX}${id}`, category: "System", description: JSON.stringify({ name, at }), amount: "0", date: at.slice(0, 10) });
  if (error) return NextResponse.json({ error: "Couldn't save that" }, { status: 500 });
  try { await sendPush(supabaseAdmin, { title: `Job signed off: ${q.clientName || name}`, body: `${q.docNumber || "Their job"} confirmed as finished by ${name}. Time for the final invoice.`, tag: `signoff-${id}`, url: "/?tab=quotes" }); } catch { /* a bonus */ }
  return NextResponse.json({ ok: true });
}
