import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildAskContext, ASK_SYSTEM } from "@/lib/askContext";
import { buildJobs } from "@/lib/finances";
import { labourLines } from "@/lib/labourInvoice";
import { supplierInvoices } from "@/lib/supplierInvoice";
import { jobProfits, routeKmMap } from "@/lib/jobProfit";

// "Ask the hub a question": reads the current leads, quotes, invoices and expenses from the database (so it's always up to date,
// whatever device asks) and has Claude answer from them. Behind the hub password like everything else.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const brisbaneToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Asking the hub isn't set up: the Anthropic key is missing." }, { status: 501 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Database not configured" }, { status: 501 });
  try {
    const body = await req.json();
    const question = String(body.question || "").trim().slice(0, 1000);
    if (!question) return NextResponse.json({ error: "Type or say a question first." }, { status: 400 });
    // earlier turns of this chat, so "and last month?" makes sense
    const history = (Array.isArray(body.history) ? body.history : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));

    const [leads, quotes, invoices, expenses, materials, settingsRows] = await Promise.all(
      ["leads", "quotes", "invoices", "expenses", "materials", "settings"].map(async (t) => {
        const { data, error } = await supabaseAdmin.from(t).select("*");
        if (error) throw new Error(`${t}: ${error.message}`);
        return data || [];
      })
    );
    const todayIso = brisbaneToday();
    let profitRows = [];
    try {
      const jobs = buildJobs({ quotes, invoices, materials, labourLines: labourLines(expenses), supplierInvoices: supplierInvoices(expenses), today: todayIso });
      profitRows = jobProfits(jobs, settingsRows?.[0] || {}, routeKmMap(expenses));
    } catch (e) { console.log("ask: profit figures skipped —", String(e?.message || e).slice(0, 100)); }
    const facts = buildAskContext({ leads, quotes, invoices, expenses, profitRows, todayIso });

    const client = new Anthropic();
    const resp = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 700,
      system: `${ASK_SYSTEM}\n\nTHE FACTS\n${facts}`,
      messages: [...history, { role: "user", content: question }],
    });
    const answer = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return NextResponse.json({ answer: answer || "I couldn't come up with an answer to that." });
  } catch (e) {
    console.log("ask failed —", String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: "Couldn't answer that just now. Try again in a moment." }, { status: 500 });
  }
}
