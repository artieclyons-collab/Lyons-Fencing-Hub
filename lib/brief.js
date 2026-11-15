// The Monday brief: every Monday morning (Brisbane) the hub writes a short plain summary of last week and what's coming up, keeps it on the
// Board and buzzes the phone. The numbers are worked out here in code; Claude only phrases them (and if Claude is unreachable the plain
// version is used). Stored as one System row ("sys-brief"), so nothing needs adding to the database. Server only.
import Anthropic from "@anthropic-ai/sdk";
import { itemsTotal, gstBreakdown, isDepositInvoice } from "./logic";
import { sendPush } from "./push";
import { weekStartOf } from "./labourWeek";
import { quotesForLead } from "./quoteDecision";

export const BRIEF_ID = "sys-brief";
const inc = (items) => Math.round(gstBreakdown(itemsTotal(items)).total);
const money = (n) => `$${Math.round(n).toLocaleString("en-AU")}`;
const add = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const names = (list, n = 4) => `${list.slice(0, n).join(", ")}${list.length > n ? ` and ${list.length - n} more` : ""}`;
const nice = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// -> the facts, as short plain lines (worked out from the data, no AI)
export function briefFacts({ leads = [], quotes = [], invoices = [], todayIso }) {
  const thisMon = weekStartOf(todayIso);
  const lastMon = add(thisMon, -7);
  const lastSun = add(thisMon, -1);
  const inLast = (d) => d && String(d).slice(0, 10) >= lastMon && String(d).slice(0, 10) <= lastSun;
  const lines = [];

  const paid = invoices.filter((i) => i.status === "Paid" && inLast(i.paidDate));
  lines.push(`Last week (${nice(lastMon)} to ${nice(lastSun)}): ${paid.length ? `${money(paid.reduce((s, i) => s + inc(i.items), 0))} came in across ${paid.length} paid ${paid.length === 1 ? "invoice" : "invoices"} (${names(paid.map((i) => i.clientName))})` : "no invoices were paid"}.`);
  const newLeads = leads.filter((l) => inLast(l.createdAt));
  const sent = quotes.filter((q) => q.status !== "Draft" && inLast(q.date));
  const won = quotes.filter((q) => q.status === "Accepted" && inLast(q.acceptedAt));
  lines.push(`${newLeads.length} new ${newLeads.length === 1 ? "lead" : "leads"}, ${sent.length} ${sent.length === 1 ? "quote" : "quotes"} sent (${money(sent.reduce((s, q) => s + inc(q.items), 0))})${won.length ? `, ${won.length} accepted (${names(won.map((q) => q.clientName))}, ${money(won.reduce((s, q) => s + inc(q.items), 0))})` : ", none accepted"}.`);

  // this week
  const weekEnd = add(thisMon, 6);
  const starting = quotes.filter((q) => q.status === "Accepted" && q.startDate && q.startDate >= thisMon && q.startDate <= weekEnd).sort((a, b) => a.startDate.localeCompare(b.startDate));
  lines.push(starting.length ? `Starting this week: ${starting.map((q) => `${q.clientName} (${nice(q.startDate)})`).join(", ")}.` : "No jobs start this week.");
  const visits = leads.filter((l) => l.visitDate && l.visitDate >= thisMon && l.visitDate <= weekEnd && ["New", "Contacted", "Quoted"].includes(l.status)).sort((a, b) => a.visitDate.localeCompare(b.visitDate));
  if (visits.length) lines.push(`Site visits booked: ${visits.map((l) => `${l.name} (${nice(l.visitDate)})`).join(", ")}.`);
  const wanted = leads.filter((l) => /Site visit wanted/i.test(l.notes || "") && !l.visitDate && l.status !== "Lost");
  if (wanted.length) lines.push(`Asked you to come and look, no day yet: ${names(wanted.map((l) => l.name))}.`);

  // money owed and quotes going cold
  const unpaid = invoices.filter((i) => i.status !== "Paid");
  if (unpaid.length) {
    const overdue = unpaid.filter((i) => i.dueDate && i.dueDate < todayIso);
    lines.push(`Owed to you: ${money(unpaid.reduce((s, i) => s + inc(i.items), 0))} across ${unpaid.length} ${unpaid.length === 1 ? "invoice" : "invoices"}${overdue.length ? `, ${overdue.length} overdue (${names(overdue.map((i) => `${i.clientName} ${money(inc(i.items))}`))})` : ""}.`);
  }
  const waiting = quotes.filter((q) => q.status === "Sent" && days(String(q.date).slice(0, 10), todayIso) >= 5 && days(String(q.date).slice(0, 10), todayIso) <= 30);
  if (waiting.length) lines.push(`Quotes still waiting for an answer (5 to 30 days): ${names([...new Set(waiting.map((q) => q.clientName))], 6)}.`);
  const newOld = leads.filter((l) => l.status === "New" && days(String(l.createdAt).slice(0, 10), todayIso) >= 3 && !quotesForLead(quotes, l).some((q) => q.status !== "Declined")); // (a lead that already has a quote isn't waiting)
  if (newOld.length) lines.push(`Leads still marked New after 3+ days: ${names(newOld.map((l) => l.name))}.`);
  return lines;
}

export async function phrase(lines) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic({ timeout: 20000, maxRetries: 0 });
    const res = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system:
        "You write the Monday morning brief for Artie, a one-man fencing business owner on the Gold Coast. Use ONLY the facts given: never add, change or invent a number, name or date. " +
        "Write 5 to 9 short plain lines in a friendly, direct Australian voice, like a mate who looks after the books. Start with one line on how last week went, then what's on this week, then what needs chasing. " +
        "No markdown, no bullets or asterisks, no emojis, no sign-off. Amounts as $1,234.",
      messages: [{ role: "user", content: lines.join("\n") }],
    });
    const t = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return t.length > 40 ? t : null;
  } catch { return null; }
}

// Once a week, from 6am to midday on a Monday (Brisbane). -> { sent } | { skipped }
export async function mondayBrief(db, nowDate = new Date(), { force = false } = {}) {
  if (!db) return { skipped: "no database" };
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(nowDate).map((x) => [x.type, x.value]));
  const todayIso = `${p.year}-${p.month}-${p.day}`;
  if (!force && (p.weekday !== "Mon" || Number(p.hour) < 6 || Number(p.hour) >= 12)) return { skipped: "not Monday morning" };
  const { data: row } = await db.from("expenses").select("description").eq("id", BRIEF_ID).maybeSingle();
  let state = {};
  try { state = JSON.parse(row?.description || "{}") || {}; } catch { state = {}; }
  if (!force && state.day === todayIso) return { skipped: "already sent today" };

  const [{ data: leads }, { data: quotes }, { data: invoices }] = await Promise.all([db.from("leads").select("*"), db.from("quotes").select("*"), db.from("invoices").select("*")]);
  const lines = briefFacts({ leads: leads || [], quotes: quotes || [], invoices: invoices || [], todayIso });
  const text = (await phrase(lines)) || lines.join("\n");
  await db.from("expenses").upsert({ id: BRIEF_ID, category: "System", description: JSON.stringify({ day: todayIso, text }), amount: "0", date: todayIso });
  const first = text.split("\n").find((l) => l.trim()) || "Your week ahead is ready.";
  const res = await sendPush(db, { title: "Your Monday brief", body: first.slice(0, 140), tag: "monday-brief", url: "/" });
  return { sent: res?.sent || 0, text };
}
