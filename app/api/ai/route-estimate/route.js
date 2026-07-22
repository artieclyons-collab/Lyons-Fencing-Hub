import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Colorbond jobs add the tip run (Reedy Creek) + materials pickup (Yatala).
// Timber jobs add the tip run (Reedy Creek) + materials pickup (Bunnings Burleigh).
export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Route estimating isn't set up — add an ANTHROPIC_API_KEY to enable it." },
      { status: 501 }
    );
  }
  try {
    const { jobAddress, jobType } = await req.json();
    if (!jobAddress) return NextResponse.json({ error: "jobAddress is required" }, { status: 400 });

    const home = "Tugun QLD 4224";
    const tip = "Reedy Creek Waste and Recycling Centre, Bermuda Street, Reedy Creek QLD";
    const colorbondYard = "Our Town Fencing, 3 Access Avenue, Yatala QLD 4207";
    const timberYard = "Bunnings Burleigh, Burleigh Heads QLD";

    let routeDesc;
    if (jobType === "Colorbond") {
      routeDesc = `starting at ${home}, driving to "${jobAddress}", then to ${tip}, then to ${colorbondYard}, then back to "${jobAddress}", then back to ${home}`;
    } else if (jobType === "Timber fencing") {
      routeDesc = `starting at ${home}, driving to "${jobAddress}", then to ${tip}, then to ${timberYard}, then back to "${jobAddress}", then back to ${home}`;
    } else {
      routeDesc = `starting at ${home}, driving to "${jobAddress}", then back to ${home}`;
    }

    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `You know the Gold Coast, QLD region well. Estimate the total driving distance in kilometres for this route, using typical roads (not straight-line distance): ${routeDesc}. Respond with ONLY this JSON and nothing else — no explanation, no markdown fences, no citations: {"km": <number>}`,
        },
      ],
    });

    const text = (response.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();

    // Try a few extraction strategies in order, since the model doesn't always follow the JSON-only instruction exactly.
    const tryParse = () => {
      try {
        const obj = JSON.parse(text);
        if (Number.isFinite(Number(obj.km))) return Number(obj.km);
      } catch {}
      const keyMatch = text.match(/"?km"?\s*[:=]\s*([\d.]+)/i);
      if (keyMatch) return Number(keyMatch[1]);
      const unitMatch = text.match(/([\d.]+)\s*km/i);
      if (unitMatch) return Number(unitMatch[1]);
      const bareMatch = text.match(/[\d.]+/);
      if (bareMatch) return Number(bareMatch[0]);
      return null;
    };

    const km = tryParse();
    if (!Number.isFinite(km)) {
      return NextResponse.json({ error: "Couldn't read a distance from the response" }, { status: 500 });
    }
    return NextResponse.json({ km: Math.round(km) });
  } catch (e) {
    console.error("route-estimate failed", e);
    return NextResponse.json({ error: "Couldn't work out a distance." }, { status: 500 });
  }
}
