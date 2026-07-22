// Client-side wrappers for the AI helpers. In the artifact these hit the Anthropic
// API directly from the browser (the sandbox proxied auth). In the real app they go
// through our own API routes, which hold the ANTHROPIC_API_KEY server-side.

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function lookupPrice(materialName) {
  const data = await post("/api/ai/price-lookup", { materialName });
  return data.text || "No pricing found — try checking your usual supplier directly.";
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Couldn't read file"));
    reader.readAsDataURL(file);
  });
}

// Reads a site photo / hand sketch / written quote and pulls out job specs using Claude vision.
export async function scanJobPhoto(file) {
  const base64 = await fileToBase64(file);
  const mediaType = file.type || "image/jpeg";
  const data = await post("/api/ai/scan-photo", { base64, mediaType });
  return data.result;
}

// Estimates return-trip driving distance for the day's route using local Gold Coast geography.
export async function estimateRouteDistance(jobAddress, jobType) {
  const data = await post("/api/ai/route-estimate", { jobAddress, jobType });
  return data.km;
}
