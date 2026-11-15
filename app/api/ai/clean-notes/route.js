import { NextResponse } from "next/server";
import { cleanNotes } from "@/lib/cleanNotes";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Not set up: the Anthropic key is missing." }, { status: 501 });
  try {
    const { text } = await req.json();
    const said = String(text || "").trim().slice(0, 4000);
    if (!said) return NextResponse.json({ error: "Say or type the notes first." }, { status: 400 });
    return NextResponse.json(await cleanNotes(said));
  } catch (e) {
    console.log("clean-notes failed —", String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: "Couldn't tidy those notes just now. Try again." }, { status: 500 });
  }
}
