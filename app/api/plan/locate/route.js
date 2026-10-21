// Address -> map position for the visit planner (OpenStreetMap Nominatim: free, no key).
// Results are cached for 30 days so each address is only looked up once. Biased to the Gold Coast
// (a soft bias — it prefers results there without excluding anything else).
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// The suburb part of a lookup like "12 Smith St Burleigh Waters, QLD, Australia",
// "10 Tropicana Ct, Burleigh Waters, QLD, Australia" or "Currumbin Waters, Gold Coast QLD, Australia".
const suburbOf = (q) => {
  const base = q.replace(/,\s*(Gold Coast )?QLD,\s*Australia$/i, "");
  if (base.includes(",")) return base.split(",").pop().trim(); // "street, suburb" -> suburb
  return base.replace(/^.*\d[^,]*?\s+(?=[A-Za-z]+(\s[A-Za-z]+)?$)/, "").trim(); // "12 Smith St Suburb" -> Suburb
};

// Street abbreviations written out in full, since the map data often has "Court", not "Ct".
const ABBREVIATIONS = [
  [/\bCtt?\b/gi, "Court"], [/\bSt\b/gi, "Street"], [/\bAve?\b/gi, "Avenue"], [/\bDr\b/gi, "Drive"], [/\bCres\b/gi, "Crescent"],
  [/\bPde\b/gi, "Parade"], [/\bRd\b/gi, "Road"], [/\bCl\b/gi, "Close"], [/\bPl\b/gi, "Place"], [/\bTce\b/gi, "Terrace"],
];
const expand = (q) => ABBREVIATIONS.reduce((s, [re, word]) => s.replace(re, word), q);

export async function POST(req) {
  try {
    const { query } = await req.json();
    if (!query || !String(query).trim()) return NextResponse.json({ error: "query is required" }, { status: 400 });

    // Full text first, then simpler versions — a suburb on its own is often what the map data is missing.
    const q = String(query);
    const sub = suburbOf(q);
    const attempts = [q, expand(q), `${sub}, Queensland, Australia`, `${sub} QLD`].filter((x, i, arr) => x && arr.indexOf(x) === i);

    let top = null;
    for (const text of attempts) {
      const params = new URLSearchParams({
        format: "jsonv2",
        countrycodes: "au",
        limit: "1",
        viewbox: "152.85,-27.55,153.65,-28.35",
        bounded: "0",
        q: text,
      });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { "User-Agent": "LyonsFencingHub/1.0 (lyonsfencingservices@gmail.com)" }, // required by Nominatim's usage policy
        next: { revalidate: 60 * 60 * 24 * 30 },
      });
      if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);
      top = (await res.json())?.[0];
      if (top) break;
    }
    if (!top) return NextResponse.json({ error: "Couldn't find that address" }, { status: 404 });
    return NextResponse.json({ lat: Number(top.lat), lon: Number(top.lon), label: top.display_name });
  } catch (e) {
    return NextResponse.json({ error: "Couldn't look up that address right now" }, { status: 502 });
  }
}
