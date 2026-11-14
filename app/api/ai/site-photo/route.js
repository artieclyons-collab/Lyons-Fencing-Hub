import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { parseJson } from "@/lib/replyDrafts";

export const runtime = "nodejs";
export const maxDuration = 60;

// Photos of a site (the fence line or where a new one goes) -> a rough read of the job: type, height, length, gates, removal, access, and what
// to check on site. It's an ESTIMATE from pictures, so every number comes with how sure it is and what it was based on.
const SYSTEM = `You are helping a Gold Coast fencing contractor (Lyons Fencing & Services) size up a job from photos before he visits. Be honest about uncertainty: photos can't give exact lengths.
Look for: existing fence (type, condition, height, posts, leaning or rotten), where the new fence would run, gates or openings, slope or retaining, trees or obstacles, access for a ute and a post-hole auger, neighbours' structures, and anything for scale (a standard door is about 2.04m high, a car about 1.8m wide, standard fence panels 1.8 to 2.4m, palings 1.8m, a brick is 230mm long, a person about 1.7m).
Job types he does: Timber fencing, Colorbond, Aluminium fencing, Chain wire fencing, Gates, Retaining wall, Repairs, Other.
Return ONLY raw JSON, no markdown, exactly this shape:
{"jobType": "one of the job types or Unclear", "summary": "one or two plain sentences on what you can see", "existingFence": "what's there now, or none visible", "heightM": number or null, "lengthM": {"low": number or null, "high": number or null, "basedOn": "what you used for scale, or why you can't tell"}, "gates": "what you can see, or none visible", "removal": true or false or null, "slopeOrRetaining": "what you can see", "access": "what you can see about access and obstacles", "confirmOnSite": ["short things to measure or ask on the visit"], "questionsForClient": ["short questions worth asking them"], "siteNotes": "2 to 4 short lines in the style he types site notes, e.g. 'approx 12m rear boundary, 1.8m timber, remove old fence, 1 gate' (say approx for anything estimated)", "confidence": "low, medium or high"}`;

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Not set up: the Anthropic key is missing." }, { status: 501 });
  try {
    const { images, note } = await req.json();
    const pics = (Array.isArray(images) ? images : []).filter((i) => i && i.base64).slice(0, 5);
    if (!pics.length) return NextResponse.json({ error: "Add at least one photo." }, { status: 400 });
    const client = new Anthropic();
    const content = [
      ...pics.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType || "image/jpeg", data: i.base64 } })),
      { type: "text", text: `${pics.length} photo${pics.length > 1 ? "s" : ""} of the site.${note ? ` What I know already: ${String(note).slice(0, 800)}` : ""} Give me your read of the job.` },
    ];
    const resp = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 1200, system: SYSTEM, messages: [{ role: "user", content }] });
    const out = parseJson((resp.content || []).filter((x) => x.type === "text").map((x) => x.text).join(" "));
    return NextResponse.json({ result: out });
  } catch (e) {
    console.log("site-photo failed —", String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: "Couldn't read those photos just now. Try again, or with fewer or smaller photos." }, { status: 500 });
  }
}
