// Daily rain forecast for the Board (Open-Meteo: free, no API key). Cached for 30 minutes
// so the Board loading doesn't hit the weather service every time.
import { NextResponse } from "next/server";
import { WEATHER_LOCATION } from "@/lib/weather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { latitude, longitude } = WEATHER_LOCATION;
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${latitude}&longitude=${longitude}` +
    "&daily=precipitation_sum,precipitation_probability_max,weather_code,temperature_2m_max,wind_gusts_10m_max" +
    "&timezone=Australia%2FBrisbane&forecast_days=16";

  try {
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) return NextResponse.json({ error: `Weather service returned ${res.status}` }, { status: 502 });
    const { daily } = await res.json();
    if (!daily?.time) return NextResponse.json({ error: "Unexpected weather response" }, { status: 502 });

    const days = daily.time.map((date, i) => ({
      date,
      rainMm: daily.precipitation_sum[i] ?? 0,
      chance: daily.precipitation_probability_max[i] ?? null,
      code: daily.weather_code[i],
      maxTemp: daily.temperature_2m_max[i],
      gust: daily.wind_gusts_10m_max[i],
    }));
    return NextResponse.json({ location: WEATHER_LOCATION.name, days });
  } catch (e) {
    return NextResponse.json({ error: "Couldn't reach the weather service" }, { status: 502 });
  }
}
