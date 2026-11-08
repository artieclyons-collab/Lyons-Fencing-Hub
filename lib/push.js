// Phone alerts (web push), server side. Subscriptions are rows in the expenses table (category "System", id "push-…"), so no database
// change is needed. Needs VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (and NEXT_PUBLIC_VAPID_PUBLIC_KEY for the browser) in the environment.
import { hasQuote } from "./leadQuotes";

// web-push is a CommonJS package: load it when needed and take its default export if the bundler gives one.
let wp = null;
async function webpushLib() {
  if (!wp) { const m = await import("web-push"); wp = m.default || m; }
  return wp;
}

export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
const NUDGE_ID = "sys-nudge";

// Sends { title, body, tag?, url? } to every phone that turned alerts on. Dead subscriptions are removed. -> { sent, removed }
export async function sendPush(db, payload) {
  if (!pushConfigured() || !db) return { sent: 0, removed: 0 };
  const webpush = await webpushLib();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:lyonsfencingservices@gmail.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const { data } = await db.from("expenses").select("id,description").like("id", "push-%");
  let sent = 0;
  const dead = [];
  for (const row of data || []) {
    let sub;
    try { sub = JSON.parse(row.description); } catch { dead.push(row.id); continue; }
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(row.id);
      else console.log("push: a send failed —", String(e?.message || e).slice(0, 100));
    }
  }
  if (dead.length) await db.from("expenses").delete().in("id", dead);
  return { sent, removed: dead.length };
}

// A hipages lead that's still waiting for a first reply gets a reminder 10 minutes after the hub first saw it, then every 30 minutes,
// up to 4 times, and only while it's fresh (under 12 hours). What's been sent is kept in one small row.
export async function nudgeUnanswered(db) {
  if (!pushConfigured() || !db) return { nudged: 0 };
  const [{ data: leads }, { data: quotes }, { data: stateRow }] = await Promise.all([
    db.from("leads").select("id,name,phone,email,source,status,createdAt"),
    db.from("quotes").select("id,docNumber,clientName,clientPhone,clientEmail,status,address,suburb"),
    db.from("expenses").select("description").eq("id", NUDGE_ID).maybeSingle(),
  ]);
  let state = {};
  try { state = JSON.parse(stateRow?.description || "{}") || {}; } catch { state = {}; }
  const now = Date.now();
  // only leads from today or yesterday (Brisbane), so an old lead nobody ever replied to doesn't start buzzing
  const day = (offset) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date(now + offset * 86400000));
  const oldest = day(-1);
  const waiting = (leads || []).filter((l) => l.source === "hipages" && l.status === "New" && String(l.createdAt || "").slice(0, 10) >= oldest && !hasQuote(l, quotes || []));
  let nudged = 0;
  for (const l of waiting) {
    const s = (state[l.id] = state[l.id] || { first: now, last: 0, n: 0 });
    const mins = Math.round((now - s.first) / 60000);
    if (now - s.first > 12 * 3600000 || s.n >= 4) continue;
    if (mins < 10 || (s.last && now - s.last < 30 * 60000)) continue;
    await sendPush(db, { title: `Reply to ${l.name || "the new lead"} (hipages)`, body: `Waiting ${mins} min. The first text wins the job.`, tag: `lead-${l.id}`, url: "/" });
    s.last = now;
    s.n += 1;
    nudged++;
  }
  for (const id of Object.keys(state)) if (!waiting.some((l) => l.id === id) && now - state[id].first > 24 * 3600000) delete state[id];
  await db.from("expenses").upsert({ id: NUDGE_ID, category: "System", description: JSON.stringify(state), amount: "0", date: new Date().toISOString().slice(0, 10) });
  return { nudged };
}
