import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { classifyAlternative } from "@/lib/variantDraft";
import { classifyTriage } from "@/lib/triage";
import { briefFacts, phrase } from "@/lib/brief";
import { cleanNotes } from "@/lib/cleanNotes";

// A check of the AI helpers on sample messages (and the Monday brief wording on your real data), without saving, sending or alerting anything.
// Behind the hub password / x-api-key like everything else. Used to confirm the AI behaves after a change.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cand = [
  { docNumber: "LFS499", items: [{ unit: "m", qty: 26, desc: "Supply and installation of butted paling timber fence at 1.8 metres high", tpl: "Butted paling timber fence installation 1.8m" }, { unit: "m", qty: 26, desc: "Removal and disposal of existing timber fence.", tpl: "Timber fence removal" }], status: "Sent", date: "2026-10-24", jobType: "Timber fencing" },
  { docNumber: "LFS500", items: [{ unit: "m", qty: 36, desc: "Supply and installation of butted paling timber fence at 1.8 metres high", tpl: "Butted paling timber fence installation 1.8m" }], status: "Sent", date: "2026-10-24", jobType: "Timber fencing" },
];

export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "no key" }, { status: 501 });
  const out = {};
  const triage = [
    "Hi Artie, I've just transferred the deposit now, should be there shortly",
    "Hey, any chance you could start a week earlier than planned?",
    "The panel next to the gate is already leaning after the storm, can you come and look",
    "Thanks heaps, the quote looks great, we'll go ahead",
    "What colour are the palings?",
  ];
  out.triage = await Promise.all(triage.map(async (t) => ({ text: t.slice(0, 60), result: await classifyTriage({ text: t, context: "Lead status: Quoted\nQuote LFS499: Accepted, starts 2026-11-23\nUnpaid invoice LFS494: $437" }) })));
  const alt = [
    "my neighbour would actually prefer Colorbond instead of timber for the 26m side, could you quote that?",
    "Thanks for the quote, can you do Thursday for the start?",
    "Could you also give us a price for aluminium slat on the front?",
  ];
  out.alternative = await Promise.all(alt.map(async (t) => ({ text: t.slice(0, 60), result: await classifyAlternative({ text: t, candidates: cand }) })));
  out.cleanNotes = await cleanNotes("twenty six metres of colorbond two metres high take out the old fence one gate and theres a tree at the end that needs to go, back boundary, monument colour");
  if (supabaseAdmin) {
    const [{ data: leads }, { data: quotes }, { data: invoices }] = await Promise.all([supabaseAdmin.from("leads").select("*"), supabaseAdmin.from("quotes").select("*"), supabaseAdmin.from("invoices").select("*")]);
    const lines = briefFacts({ leads: leads || [], quotes: quotes || [], invoices: invoices || [], todayIso: new Date().toISOString().slice(0, 10) });
    out.briefFacts = lines;
    out.briefText = await phrase(lines);
  }
  return NextResponse.json(out);
}
