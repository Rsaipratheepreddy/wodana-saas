/** A position on the map in WGS 84 degrees: the same everywhere, whatever the workspace's region. */
export type Coordinates = { latitude: number; longitude: number };

/** Both numbers are finite and on the globe: latitude within ±90, longitude within ±180. */
export function validCoordinates(latitude: number | null | undefined, longitude: number | null | undefined): boolean {
  return typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

/** Seven decimals: about a centimetre, as precise as a phone's GPS can be. */
const round = (value: number) => Math.round(value * 1e7) / 1e7;
const NUMBER = "([-+]?\\d{1,3}(?:\\.\\d+)?)";
const PAIR = new RegExp(`^\\s*(?:loc:\\s*)?${NUMBER}\\s*,\\s*${NUMBER}\\s*$`);

function point(latitude: string | number, longitude: string | number): Coordinates | null {
  const lat = Number(latitude), lng = Number(longitude);
  return validCoordinates(lat, lng) ? { latitude: round(lat), longitude: round(lng) } : null;
}
function pair(text: string | null | undefined): Coordinates | null {
  const match = text ? PAIR.exec(text.replace(/\+/g, " ")) : null;
  return match ? point(match[1], match[2]) : null;
}
function decoded(text: string) {
  try { return decodeURIComponent(text); } catch { return text; }
}

/**
 * The coordinates in a pasted map link, read without any network call: a place pin (`!3d…!4d…`), a query
 * (`?q=`, `?query=`, `?ll=`, `?destination=`…), a map centre (`/@lat,lng,zoom`), a path segment (`/place/lat,lng`),
 * `geo:` and OpenStreetMap links, or plain `lat, lng`. Short links (maps.app.goo.gl) carry no coordinates: null.
 */
export function parseMapLink(input: string): Coordinates | null {
  const text = input.trim();
  if (!text) return null;
  const plain = pair(text);
  if (plain) return plain;
  const geo = new RegExp(`^geo:${NUMBER},${NUMBER}`, "i").exec(text);
  if (geo) return point(geo[1], geo[2]);
  let url: URL;
  try { url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
  const path = decoded(url.pathname);
  const pin = new RegExp(`!3d${NUMBER}!4d${NUMBER}`).exec(decoded(url.href));
  if (pin) { const found = point(pin[1], pin[2]); if (found) return found; }
  for (const key of ["q", "query", "ll", "center", "destination", "daddr", "sll"]) {
    const found = pair(url.searchParams.get(key));
    if (found) return found;
  }
  const marker = point(url.searchParams.get("mlat") ?? "", url.searchParams.get("mlon") ?? "");
  if (marker && url.searchParams.has("mlat")) return marker;
  const centre = new RegExp(`@${NUMBER},${NUMBER}`).exec(path);
  if (centre) { const found = point(centre[1], centre[2]); if (found) return found; }
  for (const segment of path.split("/")) {
    const found = pair(segment);
    if (found) return found;
  }
  const osm = new RegExp(`map=\\d+(?:\\.\\d+)?/${NUMBER}/${NUMBER}`).exec(url.hash);
  return osm ? point(osm[1], osm[2]) : null;
}

/** Opens the position in Google Maps (its app on a phone), searching by coordinates. */
export function mapsUrl({ latitude, longitude }: Coordinates) {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
