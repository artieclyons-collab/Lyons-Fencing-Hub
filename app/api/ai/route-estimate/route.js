import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { HOME } from "@/lib/visitData";

export const runtime = "nodejs";
export const maxDuration = 60;

// The day's driving distance for a job (fuel is worked out from it): home -> job (-> tip -> materials -> job) -> home.
// Colorbond jobs add the tip run (Reedy Creek) + materials pickup (Our Town, Yatala).
// Timber jobs add the tip run (Reedy Creek) + materials pickup (Bunnings Burleigh).
// First choice is the real road distance (the job address looked up on OpenStreetMap, the route from the free OSRM routing service, the same
// one the visit planner uses). If either can't be reached, Claude estimates it from its knowledge of the area (needs ANTHROPIC_API_KEY).

// Fixed stops (looked up on OpenStreetMap, Nov 2026). Home is HOME in lib/visitData.js: 7 Matilda St, Burleigh Heads.
const HOME_POINT = { lat: -28.0987919, lon: 153.4454946 };
const TIP = { lat: -28.1077157, lon: 153.4197449, text: "Reedy Creek Waste and Recycling Centre, Bermuda Street, Reedy Creek QLD" };
const COLORBOND_YARD = { lat: -27.7369156, lon: 153.2253701, text: "Our Town Fencing, Access Avenue, Yatala QLD 4207" };
const TIMBER_YARD = { lat: -28.0999344, lon: 153.4269981, text: "Bunnings Burleigh, Bermuda Street, Burleigh Waters QLD" };

async function geocode(address) {
  try {
    const params = new URLSearchParams({ format: "jsonv2", countrycodes: "au", limit: "1", viewbox: "152.85,-27.55,153.65,-28.35", bounded: "0", q: address });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { "User-Agent": "LyonsFencingHub/1.0 (lyonsfencingservices@gmail.com)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const top = (await res.json())?.[0];
    const lat = Number(top?.lat), lon = Number(top?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  } catch {
    return null;
  }
}

// kilometres by road through the points in order, or null
async function roadKm(points) {
  try {
    const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const body = await res.json();
    const m = body?.routes?.[0]?.distance;
    return body?.code === "Ok" && Number.isFinite(m) ? m / 1000 : null;
  } catch {
    return null;
  }
}

export async function POST(req) {
  try {
    const { jobAddress, jobType } = await req.json();
    if (!jobAddress) return NextResponse.json({ error: "jobAddress is required" }, { status: 400 });

    const yard = jobType === "Colorbond" ? COLORBOND_YARD : jobType === "Timber fencing" ? TIMBER_YARD : null;

    // 1. real roads
    const job = await geocode(jobAddress);
    if (job) {
      const km = await roadKm(yard ? [HOME_POINT, job, TIP, yard, job, HOME_POINT] : [HOME_POINT, job, HOME_POINT]);
      if (Number.isFinite(km)) return NextResponse.json({ km: Math.round(km), source: "road" });
    }

    // 2. Claude's estimate
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "Couldn't look up that address on the map, and the AI estimate isn't set up (add an ANTHROPIC_API_KEY)." }, { status: 501 });
    }
    const home = HOME.query;
    const routeDesc = yard
      ? `starting at ${home}, driving to "${jobAddress}", then to ${TIP.text}, then to ${yard.text}, then back to "${jobAddress}", then back to ${home}`
      : `starting at ${home}, driving to "${jobAddress}", then back to ${home}`;

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
    return NextResponse.json({ km: Math.round(km), source: "ai" });
  } catch (e) {
    console.error("route-estimate failed", e);
    return NextResponse.json({ error: "Couldn't work out a distance." }, { status: 500 });
  }
}
