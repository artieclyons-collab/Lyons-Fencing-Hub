// Puts the hub behind its password (see lib/auth.js). Everything needs the sign-in cookie except:
//  - the sign-in page itself,
//  - what clients and your labourer open without a login: the quote accept page, the calendar feed (has its own secret
//    token) and the labourer invoice link,
//  - the files a phone needs to install the hub (icons, manifest, the alerts worker),
//  - the routes your phone-agent / text forwarding / inbox timer call: those also work with the x-api-key header
//    (and still check it themselves).
import { NextResponse } from "next/server";
import { SESSION_COOKIE, passwordSet, sessionToken, safeEqual } from "@/lib/auth";

const OPEN = new Set(["/login", "/api/login", "/sw.js", "/manifest.webmanifest", "/logo.png", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/favicon.ico", "/api/labour-pdf"]);
const HUB_ONLY_CALENDAR = new Set(["/api/calendar/sync", "/api/calendar/link"]);
const KEY_ROUTES = ["/api/leads/inbox", "/api/leads/inbound-text", "/api/leads/phone-agent", "/api/ask", "/api/ai/draft-reply", "/api/ai/site-photo"]; // TEMP for testing; /api/ask stays (Siri Shortcut)

const isOpen = (p) =>
  OPEN.has(p) ||
  p.startsWith("/accept/") ||
  p.startsWith("/api/accept/") ||
  (p.startsWith("/api/calendar/") && !HUB_ONLY_CALENDAR.has(p));

export async function middleware(req) {
  if (!passwordSet()) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (isOpen(pathname)) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && safeEqual(cookie, await sessionToken(process.env.HUB_PASSWORD))) return NextResponse.next();

  const apiKey = process.env.PHONE_AGENT_API_KEY;
  if (apiKey && KEY_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/")) && safeEqual(req.headers.get("x-api-key") || "", apiKey)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
