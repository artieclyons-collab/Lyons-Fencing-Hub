import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { TABLE_COLUMNS, sanitizeRow } from "@/lib/tableSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TABLES = new Set(Object.keys(TABLE_COLUMNS));

export async function GET(req, { params }) {
  const { table } = await params;
  if (!ALLOWED_TABLES.has(table)) return NextResponse.json({ error: "Unknown table" }, { status: 404 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Database not configured" }, { status: 501 });

  if (table === "settings") {
    const { data, error } = await supabaseAdmin.from("settings").select("*").limit(1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data || [] });
  }

  const { data, error } = await supabaseAdmin.from(table).select("*").order("inserted_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data || [] });
}

export async function PUT(req, { params }) {
  const { table } = await params;
  if (!ALLOWED_TABLES.has(table)) return NextResponse.json({ error: "Unknown table" }, { status: 404 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Database not configured" }, { status: 501 });

  const body = await req.json().catch(() => ({}));
  const rawRows = Array.isArray(body.rows) ? body.rows : body.rows ? [body.rows] : [];
  const clean = rawRows.filter(Boolean).map((r) => sanitizeRow(table, r));
  if (clean.length === 0) return NextResponse.json({ error: "No rows to upsert" }, { status: 400 });

  const { error } = await supabaseAdmin.from(table).upsert(clean);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const { table } = await params;
  if (!ALLOWED_TABLES.has(table)) return NextResponse.json({ error: "Unknown table" }, { status: 404 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Database not configured" }, { status: 501 });

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids : [];
  if (ids.length === 0) return NextResponse.json({ error: "No ids to delete" }, { status: 400 });

  const { error } = await supabaseAdmin.from(table).delete().in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
