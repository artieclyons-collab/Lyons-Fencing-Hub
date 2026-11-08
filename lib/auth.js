// Hub password: one shared password (HUB_PASSWORD in the environment). Signing in sets a cookie holding a signature made
// from the password, so changing the password signs every device out. Works in middleware (edge) and route handlers.
// If HUB_PASSWORD isn't set the hub stays open, so a deploy can never lock you out before the password is added.
export const SESSION_COOKIE = "lfs_hub";
export const SESSION_SECONDS = 60 * 60 * 24 * 365;

export const passwordSet = () => !!String(process.env.HUB_PASSWORD || "").trim();

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sessionToken(password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(String(password)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode("lyons-fencing-hub-session-v1")));
}

// compares without stopping at the first difference
export function safeEqual(a, b) {
  const x = String(a), y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

// only ever go to a page on this site after signing in
export const safeNext = (n) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/");
