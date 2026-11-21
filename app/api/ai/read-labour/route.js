import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { parseJson } from "@/lib/replyDrafts";

export const runtime = "nodejs";
export const maxDuration = 60;

// A photo or screenshot of the labourer's days and hours (his message, a note, a timesheet, a calendar) -> [{ date, hours, address }] for the
// labourer invoice. Claude only copies what's shown; the screen lets you check and change every line before anything is made.
const SYSTEM = `You read a photo or screenshot of a labourer's work days and hours (a text message, a handwritten note, a timesheet, a calendar) and copy out each day worked.
Return ONLY raw JSON, no markdown: {"days": [{"date": "YYYY-MM-DD", "hours": "...", "address": "..."}], "unclear": ["short things you could not read"]}
Rules: hours are the hours ON SITE before any lunch break is taken off. Write them exactly as shown: a start and finish like "7-3:30" or "7:30-4", or a plain number like "8" or "7.5". Convert words ("seven to half three") to that form. Dates are day/month in Australia: use the year shown, or work it out from today's date and the weekdays mentioned (a "Monday" or "Mon 16th" means the most recent such day, unless the message is clearly about the coming days). Include the job address or client name for that day only if shown, else "". Never invent a day or an hour; skip anything you can't read and list it under "unclear". Days off or "no work" are not included.`;

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Not set up: the Anthropic key is missing." }, { status: 501 });
  try {
    const { images, today, note } = await req.json();
    const pics = (Array.isArray(images) ? images : []).filter((i) => i && i.base64).slice(0, 4);
    if (!pics.length) return NextResponse.json({ error: "Add a photo or screenshot first." }, { status: 400 });
    const client = new Anthropic();
    const content = [
      ...pics.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType || "image/jpeg", data: i.base64 } })),
      { type: "text", text: `Today is ${String(today || "").slice(0, 10)}. ${note ? `Context: ${String(note).slice(0, 200)}. ` : ""}Copy out the days and hours.` },
    ];
    const resp = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 1500, system: SYSTEM, messages: [{ role: "user", content }] });
    const out = parseJson((resp.content || []).filter((x) => x.type === "text").map((x) => x.text).join(" "));
    const days = (Array.isArray(out.days) ? out.days : [])
      .map((d) => ({ date: String(d.date || "").slice(0, 10), hours: String(d.hours ?? "").trim().slice(0, 20), address: String(d.address || "").trim().slice(0, 120) }))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.hours)
      .slice(0, 31);
    return NextResponse.json({ days, unclear: Array.isArray(out.unclear) ? out.unclear.map(String).slice(0, 6) : [] });
  } catch (e) {
    console.log("read-labour failed —", String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: "Couldn't read that. Try a clearer photo, or type the days in." }, { status: 500 });
  }
}
