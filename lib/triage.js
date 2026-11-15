// What a client's message is really about, for the things that need you but aren't handled elsewhere: "I've paid", "can you start earlier",
// "there's a problem with the fence". It writes a plain line on their lead and buzzes the phone. It never replies, never marks anything paid
// and never changes a date: it only makes sure you see it. Server only (uses Claude and the database).
import Anthropic from "@anthropic-ai/sdk";
import { itemsTotal, gstBreakdown } from "./logic";
import { quotesForLead } from "./quoteDecision";
import { sendPush } from "./push";

// only messages with a hint of these are worth asking Claude about
const WORTH = /\b(?:paid|payment|transferred|transfer(?:red)?|deposit|pay(?:ing)?|settled|complain\w*|not\s+happy|unhappy|disappointed|damage\w*|leaning|fell|collapsed|broken|problem|issue|wrong|mistake|mess|earlier|sooner|later|postpone\w*|delay\w*|re-?schedul\w*|can\s+you\s+start|when\s+(?:are|can)\s+you|start\s+date|come\s+back|not\s+right)\b/i;
const INTENTS = ["payment_made", "start_change", "problem"];
const brisbaneDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane", day: "numeric", month: "short" }).format(new Date());

export async function classifyTriage({ text, context }) {
  const client = new Anthropic({ timeout: 12000, maxRetries: 0 });
  for (const model of ["claude-haiku-5-5", "claude-sonnet-4-6"]) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 160,
        system:
          "You read a message from a fencing customer to the owner and decide if it is one of: " +
          "payment_made (they say they have paid, or just transferred money), " +
          "start_change (they ask to start the job earlier or later, or move the start date), " +
          "problem (they report something wrong with the finished or in-progress work, or are unhappy), " +
          "other (anything else: thanks, questions, accepting a quote, booking a visit, etc). " +
          "Pick other unless it clearly is one of the first three. summary is one short plain sentence (under 120 characters) about what they said. " +
          "Reply with ONLY raw JSON: {\"intent\": \"payment_made\"|\"start_change\"|\"problem\"|\"other\", \"summary\": \"...\"}",
        messages: [{ role: "user", content: `What we know about them:\n${context}\n\nTheir message:\n${String(text).slice(0, 1500)}` }],
      });
      const out = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ");
      const a = out.indexOf("{"), b = out.lastIndexOf("}");
      if (a < 0 || b < a) continue;
      return JSON.parse(out.slice(a, b + 1));
    } catch { /* next model */ }
  }
  return null;
}

// -> null | { intent, noteLine }
export async function triageMessage({ db, lead, text }) {
  try {
    if (!process.env.ANTHROPIC_API_KEY || !db || !WORTH.test(String(text || ""))) return null;
    const [{ data: quotes }, { data: invoices }] = await Promise.all([db.from("quotes").select("id,docNumber,clientName,clientPhone,clientEmail,status,startDate,date"), db.from("invoices").select("id,docNumber,clientName,clientEmail,status,items,quoteId,issuedDate")]);
    const mine = quotesForLead(quotes || [], lead);
    const ids = new Set(mine.map((q) => q.id));
    const myInvoices = (invoices || []).filter((i) => (i.quoteId && ids.has(i.quoteId)) || (lead.email && String(i.clientEmail || "").toLowerCase() === String(lead.email).toLowerCase()));
    const unpaid = myInvoices.filter((i) => i.status !== "Paid");
    const total = (i) => Math.round(gstBreakdown(itemsTotal(i.items)).total);
    const context = [
      `Lead status: ${lead.status}`,
      ...mine.map((q) => `Quote ${q.docNumber}: ${q.status}${q.startDate ? `, starts ${q.startDate}` : ""}`),
      ...unpaid.map((i) => `Unpaid invoice ${i.docNumber}: $${total(i)}`),
    ].join("\n") || "nothing yet";

    const v = await classifyTriage({ text, context });
    if (!v || !INTENTS.includes(v.intent)) return null;
    const when = brisbaneDay();
    const summary = String(v.summary || "").replace(/\s+/g, " ").trim().slice(0, 140);
    const label = { payment_made: "Says they've paid", start_change: "Asked to change the start date", problem: "Reported a problem" }[v.intent];
    const noteLine = `${label} (${when}): ${summary || "see their message"}${v.intent === "payment_made" && unpaid.length ? ` Unpaid: ${unpaid.map((i) => `${i.docNumber} $${total(i).toLocaleString("en-AU")}`).join(", ")}. Check your bank.` : ""}`;
    if (String(lead.notes || "").includes(`${label} (${when})`)) return null; // already noted today

    const bodies = {
      payment_made: `${summary || "Says they've paid."}${unpaid.length ? ` Unpaid: ${unpaid.map((i) => i.docNumber).join(", ")}. Check your bank, then Match payments.` : ""}`,
      start_change: summary || "Wants to change the start date.",
      problem: summary || "Reported a problem.",
    };
    await sendPush(db, { title: `${v.intent === "problem" ? "Problem" : v.intent === "payment_made" ? "Payment" : "Start date"}: ${lead.name}`, body: bodies[v.intent].slice(0, 140), tag: `triage-${lead.id}-${v.intent}`, url: v.intent === "payment_made" ? "/?tab=invoices" : "/?tab=quotes" });
    return { intent: v.intent, noteLine };
  } catch (e) {
    console.log("triage: skipped —", String(e?.message || e).slice(0, 120));
    return null;
  }
}
