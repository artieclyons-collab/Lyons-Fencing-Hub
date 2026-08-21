// Webhook for third-party voice-AI platforms (Vapi, Synthflow, etc.) to create
// leads from phone calls. Locked down with a shared secret (PHONE_AGENT_API_KEY)
// since it has no other login — anyone with the key can create leads, nothing more.
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { uid, today } from "@/lib/logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOB_TYPE_MAP = {
  "colorbond fencing": "Colorbond",
  "colorbond": "Colorbond",
  "timber fencing": "Timber fencing",
  "gates": "Gates",
  "retaining wall": "Retaining wall",
  "repair": "Repairs",
  "repairs": "Repairs",
  "basic landscaping": "Landscaping",
  "landscaping": "Landscaping",
  "not sure": "Not sure",
};

function normalizeJobType(raw) {
  const key = String(raw || "").trim().toLowerCase();
  if (!key) return "Not sure";
  if (JOB_TYPE_MAP[key]) return JOB_TYPE_MAP[key];
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

function isAuthorized(req) {
  const expected = process.env.PHONE_AGENT_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-api-key") || "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req) {
  if (!process.env.PHONE_AGENT_API_KEY) {
    return NextResponse.json({ error: "Not configured" }, { status: 501 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 501 });
  }

  const body = await req.json().catch(() => ({}));
  const callerName = String(body.callerName || body.name || "").trim();
  const phone = String(body.phone || body.phoneNumber || "").trim();
  const suburb = String(body.suburb || "").trim();
  const jobDetails = String(body.jobDetails || "").trim();
  const estimateGiven = String(body.estimateGiven || "").trim();

  if (!callerName) return NextResponse.json({ error: "callerName is required" }, { status: 400 });
  if (!phone) return NextResponse.json({ error: "phone is required" }, { status: 400 });

  const notesLines = [];
  if (jobDetails) notesLines.push(`Job details: ${jobDetails}`);
  if (estimateGiven) notesLines.push(`Estimate given: ${estimateGiven}`);

  const row = {
    id: uid(),
    name: callerName,
    phone,
    email: null,
    address: suburb,
    jobType: normalizeJobType(body.jobType),
    status: "New",
    notes: notesLines.join("\n"),
    createdAt: today(),
    source: "phone_agent",
  };

  const { error } = await supabaseAdmin.from("leads").insert(row);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, leadId: row.id }, { status: 201 });
}
