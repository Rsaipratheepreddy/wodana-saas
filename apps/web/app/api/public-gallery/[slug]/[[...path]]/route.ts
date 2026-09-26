import { NextResponse } from "next/server";
import { businessApiUrl } from "@/lib/auth/server";
import { isSameOrigin, UUID } from "@/lib/workspace/workspace-api";

const SLUG = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/i;

/** A published gallery's pictures and enquiries (no sign-in). */
async function handle(request: Request, { params }: { params: Promise<{ slug: string; path?: string[] }> }) {
  const { slug, path = [] } = await params;
  if (!SLUG.test(slug)) return NextResponse.json({ message: "Gallery not found." }, { status: 404 });
  const url = new URL(request.url);
  if (request.method === "GET" && path.length === 2 && path[0] === "images" && UUID.test(path[1])) {
    const range = request.headers.get("range");
    const upstream = await fetch(businessApiUrl(`/public/gallery/${slug}/images/${path[1]}${url.searchParams.get("preview") === "1" ? "?preview=1" : ""}`), { headers: range ? { range } : undefined, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (!upstream || (!upstream.ok && upstream.status !== 206)) return NextResponse.json({ message: "Image not found." }, { status: upstream?.status ?? 503 });
    const headers: Record<string, string> = { "content-type": upstream.headers.get("content-type") ?? "image/webp", "cache-control": "public, max-age=3600, stale-while-revalidate=86400", "x-content-type-options": "nosniff", "accept-ranges": "bytes" };
    for (const name of ["content-range", "content-length"]) { const value = upstream.headers.get(name); if (value) headers[name] = value; }
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  }
  if (request.method === "POST" && path.length === 1 && path[0] === "enquiries") {
    if (!isSameOrigin(request)) return NextResponse.json({ message: "Please send your list from the gallery." }, { status: 403 });
    const body = await request.text();
    if (body.length > 60000) return NextResponse.json({ message: "Your answers are too long." }, { status: 413 });
    try {
      JSON.parse(body);
      const response = await fetch(businessApiUrl(`/public/gallery/${slug}/enquiries`), { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      return NextResponse.json(response.status >= 500 ? { message: "Your enquiry could not be sent. Please try again." } : result, { status: response.status });
    } catch { return NextResponse.json({ message: "Your enquiry could not be sent. Please try again." }, { status: 503 }); }
  }
  return NextResponse.json({ message: "Not found." }, { status: 404 });
}
export { handle as GET, handle as POST };
