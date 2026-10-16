/**
 * A short map link (the Google Maps app's Share: maps.app.goo.gl/…) carries no coordinates; only the page it
 * redirects to does. This follows that redirect on the server (the browser can't read a cross-origin Location),
 * only for the short-link hosts, without reading any page body, and returns the long link for the client to parse.
 * A link that isn't a short one, or that doesn't redirect, resolves to null.
 */
const SHORT_LINK_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.co"]);
const MAX_HOPS = 5;

export function isShortMapLink(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return (url.protocol === "https:" || url.protocol === "http:") && SHORT_LINK_HOSTS.has(url.hostname.toLowerCase());
  } catch { return false; }
}

export async function resolveMapLink(input: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!isShortMapLink(input)) return null;
  let current = new URL(input.trim());
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const response = await fetchImpl(current.toString(), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(6000), headers: { "user-agent": "Mozilla/5.0 (compatible; Wodana)" } });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (!location) return hop ? current.toString() : null;
    let next: URL;
    try { next = new URL(location, current); } catch { return null; }
    // Google's consent page carries the real destination in `continue`.
    const carried = next.hostname === "consent.google.com" ? next.searchParams.get("continue") : null;
    if (carried) { try { next = new URL(carried); } catch { return null; } }
    if (next.protocol !== "https:" && next.protocol !== "http:") return null;
    current = next;
    if (!SHORT_LINK_HOSTS.has(current.hostname.toLowerCase())) return current.toString();
  }
  return current.toString();
}
