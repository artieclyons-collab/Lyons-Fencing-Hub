// Colorbond colour names, so a colour mentioned in a lead's notes or a client's text ("monument", "she picked Basalt") can go on the quote.
// Safe for the app screens and the server (no imports).
const STRONG = ["Monument", "Basalt", "Surfmist", "Woodland Grey", "Shale Grey", "Classic Cream", "Paperbark", "Evening Haze", "Pale Eucalypt", "Windspray", "Jasper", "Manor Red", "Wilderness", "Bluegum", "Ironstone", "Night Sky", "Deep Ocean", "Cottage Green", "Riversand", "Dune"];
// ordinary words too ("gully", "terrain"), so these only count when the text also talks about colour
const WEAK = ["Cove", "Gully", "Terrain", "Domain", "Mangrove"];

// "woodland grey" also matches "woodland gray", "woodlandgrey" and "woodland-grey"
const flex = (name) => new RegExp("\\b" + name.toLowerCase().replace(/grey/, "gr[ea]y").replace(/\s+/g, "[\\s-]*") + "\\b", "i");
const STRONG_RE = STRONG.map((n) => [n, flex(n)]);
const WEAK_RE = WEAK.map((n) => [n, flex(n)]);

// every colour named in the text, in the order of the list -> ["Monument", "Basalt"]
export function findColours(text) {
  const t = String(text || "");
  const out = STRONG_RE.filter(([, re]) => re.test(t)).map(([name]) => name);
  if (/colou?r/i.test(t)) out.push(...WEAK_RE.filter(([, re]) => re.test(t)).map(([name]) => name));
  return out;
}

// -> "Monument" / "Woodland Grey" / "" (the first one found)
export const findColour = (text) => findColours(text)[0] || "";

// Colorbond fence/gate lines get the colour in their wording: "Colorbond fence" -> "Colorbond fence in Monument" (once per line, never twice)
export function withColour(desc, colour) {
  const d = String(desc || "");
  if (!colour || d.toLowerCase().includes(`in ${colour.toLowerCase()}`)) return d;
  return d.replace(/\bColorbond\s+(?:[A-Za-z]+\s+){0,2}?(?:fence|gate)\b/i, (m) => `${m} in ${colour}`);
}
