import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { today } from "@/lib/logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, unauthenticated by design (the client opens this from a shared
// link with no login) — but scoped tightly: GET returns one quote by id,
// POST only ever sets status to Accepted/Declined (+ name/date on accept).
// No other fields can be touched through this route.
export async function GET(_req, { params }) {
  const { id } = await params;
  if (!supabaseAdmin) return NextResponse.json({ error: "Not configured" }, { status: 501 });

  const { data, error } = await supabaseAdmin.from("quotes").select("*").eq("id", id).limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ quote: data[0] });
}

export async function POST(req, { params }) {
  const { id } = await params;
  if (!supabaseAdmin) return NextResponse.json({ error: "Not configured" }, { status: 501 });

  const body = await req.json().catch(() => ({}));
  if (body.status !== "Accepted" && body.status !== "Declined") {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  let updates;
  if (body.status === "Accepted") {
    const name = String(body.name || "").trim().slice(0, 200);
    if (!name) return NextResponse.json({ error: "Name is required to accept" }, { status: 400 });
    updates = { status: "Accepted", acceptedAt: today(), acceptedByName: name };
  } else {
    updates = { status: "Declined" };
  }

  const { error } = await supabaseAdmin.from("quotes").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, quote: updates });
}
