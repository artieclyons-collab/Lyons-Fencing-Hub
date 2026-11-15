// A client (or their neighbour) asks for the same fence in another material ("my neighbour wants Colorbond instead"): the hub drafts that
// quote itself, from the quote you already sent, so it's waiting for you to check and send. It is only ever a DRAFT, never emailed.
// Server only (uses the database, Claude and phone alerts). The conversion itself is lib/quoteVariant.js (also the button on the quote screen).
import Anthropic from "@anthropic-ai/sdk";
import { variantFromQuote, jobTypeOfQuote } from "./quoteVariant";
import { quotesForLead } from "./quoteDecision";
import { sanitizeRow } from "./tableSchema";
import { itemsTotal, gstBreakdown, uid } from "./logic";
import { sendPush } from "./push";

// only messages that mention a material or ask for something different are worth a look (saves a Claude call on every email)
const WORTH_A_LOOK = /colou?rbond|steel|timber|wood|paling|alumin|slat|lapped|capped|good\s+neighbou?r|instead|rather|alternative|another\s+(?:option|quote)|different|also\s+(?:get|want|quote)/i;

const brisbaneDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date());
const lengthOf = (q) => (q.items || []).filter((i) => i.unit === "m" && !/\bremov/i.test(String(i.desc || "").slice(0, 60)) && !/\bgates?\b/i.test(i.desc || "")).reduce((n, i) => n + (Number(i.qty) || 0), 0);
const incTotal = (q) => Math.round(gstBreakdown(itemsTotal(q.items)).total);

export async function classifyAlternative({ text, candidates }) {
  const list = candidates.map((q) => `${q.docNumber} | ${jobTypeOfQuote(q)} | ${Math.round(lengthOf(q) * 10) / 10}m | ${q.status} | ${String(q.date || "").slice(0, 10)}`).join("\n");
  const client = new Anthropic({ timeout: 12000, maxRetries: 0 });
  for (const model of ["claude-haiku-5-5", "claude-sonnet-4-6"]) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 200,
        system:
          "You read a message from a fencing customer and decide whether they are asking for a quote for the SAME fence in a DIFFERENT material (Colorbond or timber), including when it's their neighbour who wants the other material. " +
          "ask is true only for that. It is false if they are just asking questions about, accepting, declining or discussing an existing quote, booking a time, or asking about something else. " +
          "If they name a length or quote number, pick that quote as basedOn; otherwise null. Reply with ONLY raw JSON: {\"ask\": true|false, \"material\": \"Colorbond\"|\"Timber fencing\"|null, \"basedOn\": \"LFS123\"|null}",
        messages: [{ role: "user", content: `Their quotes so far (number | material | length | status | date):\n${list}\n\nTheir message:\n${String(text).slice(0, 1500)}` }],
      });
      const out = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ");
      const a = out.indexOf("{"), b = out.lastIndexOf("}");
      if (a < 0 || b < a) continue;
      return JSON.parse(out.slice(a, b + 1));
    } catch { /* try the next model */ }
  }
  return null;
}

// the next quote number, the same rule the app uses: above every quote and invoice number already used, and above the counter
async function allocateNumber(db) {
  const [{ data: qs }, { data: is }, { data: st }] = await Promise.all([db.from("quotes").select("docNumber"), db.from("invoices").select("docNumber"), db.from("settings").select("*").limit(1)]);
  const used = [...(qs || []), ...(is || [])].map((r) => Number(String(r.docNumber || "").match(/^LFS(\d+)/i)?.[1]) || 0);
  const settings = st?.[0];
  const next = Math.max(Number(settings?.nextDocNumber) || 458, Math.max(0, ...used) + 1);
  if (settings?.id) await db.from("settings").update({ nextDocNumber: String(next + 1) }).eq("id", settings.id);
  return `LFS${next}`;
}

// -> null (nothing to do) | { created: "LFS550", from: "LFS499" } | { existing: "LFS549" } | { ambiguous: true }
export async function draftAlternativeQuote({ db, lead, text }) {
  try {
    if (!process.env.ANTHROPIC_API_KEY || !db || !WORTH_A_LOOK.test(String(text || ""))) return null;
    const { data: all } = await db.from("quotes").select("*");
    const mine = quotesForLead(all || [], lead).filter((q) => q.status !== "Declined");
    const candidates = mine.filter((q) => q.status !== "Draft" && (q.items || []).length);
    if (!candidates.length) return null;

    const verdict = await classifyAlternative({ text, candidates });
    if (!verdict?.ask || !["Colorbond", "Timber fencing"].includes(verdict.material)) return null;
    const target = verdict.material;

    // which quote to copy: the one they named, else the newest sent one in the OTHER material (when there's only one length on the table)
    const other = candidates.filter((q) => jobTypeOfQuote(q) !== target);
    if (!other.length) return null; // they already have a quote in that material
    let base = other.find((q) => q.docNumber === verdict.basedOn);
    if (!base) {
      const lengths = new Set(other.filter((q) => q.status === "Sent" || q.status === "Accepted").map((q) => Math.round(lengthOf(q))));
      if (lengths.size > 1) {
        await sendPush(db, { title: `${lead.name} wants a ${target === "Colorbond" ? "Colorbond" : "timber"} option`, body: "They have more than one quote, so I didn't guess which. Open the quote and tap Make a version.", tag: `variant-${lead.id}`, url: "/?tab=quotes" });
        return { ambiguous: true };
      }
      base = [...other].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
    }

    // already done (by hand, or by an earlier message): same material, about the same length
    const dup = mine.find((q) => jobTypeOfQuote(q) === target && Math.abs(lengthOf(q) - lengthOf(base)) <= 0.5 && (q.items || []).length);
    if (dup) return { existing: dup.docNumber };

    const v = variantFromQuote(base, target);
    if (!v) return null;
    const docNumber = await allocateNumber(db);
    const { summary, ...fields } = v;
    const row = sanitizeRow("quotes", {
      ...fields,
      id: uid(),
      docNumber,
      status: "Draft",
      date: brisbaneDay(),
      clientEmail: base.clientEmail || fields.clientEmail || "",
      notes: `${fields.notes || ""}`.trim(),
    });
    const { error } = await db.from("quotes").insert(row);
    if (error) { console.log("variant draft: couldn't save —", String(error.message).slice(0, 100)); return null; }
    const noteLine = `${target === "Colorbond" ? "Colorbond" : "Timber"} option drafted automatically (${docNumber}, from ${base.docNumber}). Check it and send.`;
    await sendPush(db, { title: `Draft ${target === "Colorbond" ? "Colorbond" : "timber"} quote ready: ${lead.name}`, body: `${docNumber} · $${incTotal(row).toLocaleString("en-AU")} inc. GST, copied from ${base.docNumber}. Check it and send.`, tag: `variant-${lead.id}`, url: "/?tab=quotes" });
    return { created: docNumber, from: base.docNumber, noteLine }; // the caller adds the line to the lead's notes along with its own changes
  } catch (e) {
    console.log("variant draft: skipped —", String(e?.message || e).slice(0, 120));
    return null;
  }
}
