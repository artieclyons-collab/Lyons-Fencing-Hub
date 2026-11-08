// POST { password } -> sets the sign-in cookie. DELETE -> signs out on this device.
import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_SECONDS, passwordSet, sessionToken, safeEqual } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// slows down guessing: after 8 wrong tries from one place in 15 minutes it stops answering for a while (best effort per server)
const fails = new Map();
const WINDOW = 15 * 60 * 1000;
const ip = (req) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

export async function GET() {
  return NextResponse.json({ protected: passwordSet() });
}

export async function POST(req) {
  if (!passwordSet()) return NextResponse.json({ error: "No password is set up yet" }, { status: 501 });
  const who = ip(req);
  const now = Date.now();
  const recent = (fails.get(who) || []).filter((t) => now - t < WINDOW);
  if (recent.length >= 8) return NextResponse.json({ error: "Too many tries. Wait a few minutes and try again." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const given = String(body.password || "");
  if (!safeEqual(given, String(process.env.HUB_PASSWORD).trim()) && !safeEqual(given, String(process.env.HUB_PASSWORD))) {
    recent.push(now);
    fails.set(who, recent);
    await new Promise((r) => setTimeout(r, 1000));
    return NextResponse.json({ error: "That password isn't right" }, { status: 401 });
  }
  fails.delete(who);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(process.env.HUB_PASSWORD), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
