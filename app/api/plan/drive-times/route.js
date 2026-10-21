// Driving minutes between every pair of points, for the visit planner. Uses the free OSRM routing service
// (real roads, free-flow speeds). If it can't be reached, falls back to a straight-line estimate and says so.
import { NextResponse } from "next/server";
import { estimateDriveMin } from "@/lib/visitPlanner";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req) {
  const { points } = await req.json().catch(() => ({}));
  if (!Array.isArray(points) || points.length < 2 || points.length > 80 || points.some((p) => !Number.isFinite(p?.lat) || !Number.isFinite(p?.lon))) {
    return NextResponse.json({ error: "points must be 2–80 {lat, lon} pairs" }, { status: 400 });
  }

  const estimate = () => points.map((a) => points.map((b) => estimateDriveMin(a, b)));
  try {
    const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
    const res = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration`, {
      signal: AbortSignal.timeout(12000),
      next: { revalidate: 60 * 60 * 6 },
    });
    if (!res.ok) throw new Error(`OSRM returned ${res.status}`);
    const { code, durations } = await res.json();
    if (code !== "Ok" || !durations) throw new Error("OSRM gave no table");
    const fallback = estimate();
    let filled = 0;
    const minutes = durations.map((row, i) => row.map((sec, j) => {
      if (i === j) return 0;
      if (sec == null) { filled++; return fallback[i][j]; }
      return sec / 60;
    }));
    return NextResponse.json({ minutes, source: filled ? "mixed" : "osrm" });
  } catch (e) {
    return NextResponse.json({ minutes: estimate(), source: "estimate" });
  }
}
