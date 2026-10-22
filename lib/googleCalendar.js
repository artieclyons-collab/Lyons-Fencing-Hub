// A small Google Calendar client (no SDK): signs in as a "service account" and lists, creates, changes and deletes
// events on one calendar. Server-only. Everything the sync needs, nothing else.
import crypto from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/calendar";

// GOOGLE_SERVICE_ACCOUNT_JSON holds the downloaded key file (paste the whole file). Returns null if it isn't set up.
export function loadCredentials(env = process.env) {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || !env.GOOGLE_CALENDAR_ID) return null;
  try {
    const j = JSON.parse(raw);
    if (!j.client_email || !j.private_key) return null;
    return { client_email: j.client_email, private_key: String(j.private_key).replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

export function createGoogleClient({
  credentials,
  calendarId,
  apiBase = "https://www.googleapis.com/calendar/v3",
  tokenUrl = "https://oauth2.googleapis.com/token",
  fetchImpl = fetch,
}) {
  let token = null;
  let expires = 0;

  async function accessToken() {
    if (token && Date.now() < expires - 60000) return token;
    const now = Math.floor(Date.now() / 1000);
    const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iss: credentials.client_email, scope: SCOPE, aud: tokenUrl, iat: now, exp: now + 3600 })}`;
    const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(credentials.private_key).toString("base64url");
    const res = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw new Error(`Google sign-in failed: ${body.error_description || body.error || res.status}`);
    token = body.access_token;
    expires = Date.now() + (body.expires_in || 3600) * 1000;
    return token;
  }

  const eventsUrl = (suffix = "") => `${apiBase}/calendars/${encodeURIComponent(calendarId)}/events${suffix}`;

  async function call(method, url, body) {
    const res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return { ok: true, status: 204 };
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }
  const fail = (what, r) => new Error(`Google Calendar ${what} failed (${r.status}): ${r.json?.error?.message || "unknown error"}`);

  return {
    // Every event this hub manages (including ones deleted in the calendar, which Google keeps as "cancelled").
    async listManaged(timeMinIso) {
      const out = [];
      let pageToken = "";
      for (let page = 0; page < 20; page++) {
        const q = new URLSearchParams({ privateExtendedProperty: "hubManaged=1", showDeleted: "true", singleEvents: "true", maxResults: "2500", timeMin: timeMinIso });
        if (pageToken) q.set("pageToken", pageToken);
        const r = await call("GET", eventsUrl(`?${q}`));
        if (!r.ok) throw fail("list", r);
        out.push(...(r.json.items || []));
        pageToken = r.json.nextPageToken || "";
        if (!pageToken) break;
      }
      return out;
    },
    async insert(body) {
      const r = await call("POST", eventsUrl(), body);
      if (r.status === 409) return { exists: true }; // already there (or deleted on the phone) — leave it
      if (!r.ok) throw fail("create", r);
      return { created: true };
    },
    async patch(id, body) {
      const r = await call("PATCH", eventsUrl(`/${encodeURIComponent(id)}`), body);
      if (r.status === 404 || r.status === 410) return { gone: true };
      if (!r.ok) throw fail("update", r);
      return { updated: true };
    },
    async remove(id) {
      const r = await call("DELETE", eventsUrl(`/${encodeURIComponent(id)}`));
      if (r.status === 404 || r.status === 410) return { gone: true };
      if (!r.ok) throw fail("delete", r);
      return { removed: true };
    },
    // Used by "check connection": can we sign in and see the calendar?
    async check() {
      const r = await call("GET", `${apiBase}/calendars/${encodeURIComponent(calendarId)}`);
      if (!r.ok) throw fail("check", r);
      return { name: r.json.summary || calendarId, timeZone: r.json.timeZone || "" };
    },
  };
}
