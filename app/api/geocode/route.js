import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Free, no-API-key address lookup via OpenStreetMap Nominatim, biased toward the
// Gold Coast / northern NSW area where Lyons Fencing operates (soft bias via
// viewbox — doesn't exclude results outside it, just prefers them). Good enough
// to auto-fill suburb/state/postcode from a street address; always let the
// tradie double-check before it goes out on a document.
const STATE_ABBR = {
  Queensland: "QLD",
  "New South Wales": "NSW",
  Victoria: "VIC",
  "South Australia": "SA",
  "Western Australia": "WA",
  Tasmania: "TAS",
  "Northern Territory": "NT",
  "Australian Capital Territory": "ACT",
};

export async function POST(req) {
  try {
    const { address } = await req.json();
    if (!address || !address.trim()) {
      return NextResponse.json({ error: "address is required" }, { status: 400 });
    }

    const params = new URLSearchParams({
      format: "jsonv2",
      addressdetails: "1",
      countrycodes: "au",
      limit: "1",
      viewbox: "152.85,-27.55,153.65,-28.35",
      bounded: "0",
      q: address,
    });

    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: {
        // Nominatim's usage policy requires a descriptive User-Agent identifying the app.
        "User-Agent": "LyonsFencingHub/1.0 (lyonsfencingservices@gmail.com)",
      },
    });
    if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);
    const results = await res.json();
    const top = results?.[0];
    if (!top) {
      return NextResponse.json(
        { error: "Couldn't find that address — check the spelling or enter the suburb manually." },
        { status: 404 }
      );
    }

    const a = top.address || {};
    const suburb = a.suburb || a.village || a.town || a.city_district || a.city || a.municipality || "";
    const state = STATE_ABBR[a.state] || a.state || "";
    const postcode = a.postcode || "";

    const parts = [suburb, state, postcode].filter(Boolean);
    if (parts.length === 0) {
      return NextResponse.json(
        { error: "Found the address but couldn't work out the suburb — enter it manually." },
        { status: 404 }
      );
    }
    return NextResponse.json({ suburb: parts.join(" ") });
  } catch (e) {
    console.error("geocode failed", e);
    return NextResponse.json({ error: "Couldn't look up that address right now." }, { status: 500 });
  }
}
