// Client-side wrapper for the address-lookup route (free OpenStreetMap
// Nominatim geocoding — no API key needed).
export async function lookupSuburb(address) {
  const res = await fetch("/api/geocode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data.suburb;
}
