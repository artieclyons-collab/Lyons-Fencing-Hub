// Sends the post-call confirmation SMS for the phone-agent (Retell) integration.
// The agent composes the actual message text itself (trained on Artie's tone);
// this route is just a secured relay to Twilio's REST API. Same shared secret
// as /api/leads/phone-agent protects it.
import { NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const { PHONE_AGENT_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;

  if (!PHONE_AGENT_API_KEY) {
    return NextResponse.json({ error: "Not configured" }, { status: 501 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return NextResponse.json({ error: "SMS not configured" }, { status: 501 });
  }

  const body = await req.json().catch(() => ({}));
  const to = String(body.to || "").trim();
  const message = String(body.message || "").trim();

  if (!to) return NextResponse.json({ error: "to is required" }, { status: 400 });
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const twilioRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: message }),
    }
  );

  const data = await twilioRes.json().catch(() => ({}));
  if (!twilioRes.ok) {
    return NextResponse.json({ error: data.message || "Twilio send failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, sid: data.sid }, { status: 201 });
}
