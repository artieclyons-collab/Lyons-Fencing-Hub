// Rain outlook for the Board. Forecast comes from Open-Meteo (free, no key) via /api/weather.

// One spot for the whole Gold Coast / Tweed patch (Burleigh) — good enough to decide whether a day is a wash-out.
export const WEATHER_LOCATION = { name: "Gold Coast", latitude: -28.07, longitude: 153.45 };

// How wet a day is for outdoor fencing work, from the day's total rain.
//   heavy   15mm+   write the day off
//   wet     5–15mm  concreting and sheeting are a struggle
//   showers 1–5mm   workable, keep an eye on it
export const HEAVY_MM = 15;
export const WET_MM = 5;
export const SHOWERS_MM = 1;

export function rainLevel(mm) {
  const n = Number(mm) || 0;
  if (n >= HEAVY_MM) return "heavy";
  if (n >= WET_MM) return "wet";
  if (n >= SHOWERS_MM) return "showers";
  return "dry";
}

// A day you'd probably move a job off.
export const isWetDay = (day) => !!day && (rainLevel(day.rainMm) === "heavy" || rainLevel(day.rainMm) === "wet");

export const RAIN_LABEL = { heavy: "Heavy rain", wet: "Wet", showers: "Showers", dry: "Dry" };

// WMO weather code -> which icon to show (the component maps these names to icons).
export function weatherIcon(code) {
  const c = Number(code);
  if (c === 0 || c === 1) return "sun";
  if (c === 2) return "partly";
  if (c === 3) return "cloud";
  if (c === 45 || c === 48) return "fog";
  if (c >= 51 && c <= 57) return "drizzle";
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return "rain";
  if (c >= 95) return "storm";
  return "cloud";
}
