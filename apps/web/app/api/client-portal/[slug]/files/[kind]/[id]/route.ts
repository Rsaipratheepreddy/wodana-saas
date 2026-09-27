import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { businessApiUrl } from "@/lib/auth/server";
import { PORTAL_SLUG, portalCookie } from "@/lib/client-portal/server";

const KINDS = ["design", "photo", "handover", "agreement"];
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A file shared with the signed-in client, streamed privately: never cached, never scriptable. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; kind: string; id: string }> }) {
  const { slug, kind, id } = await params;
  if (!PORTAL_SLUG.test(slug) || !KINDS.includes(kind) || !ID.test(id)) return new NextResponse(null, { status: 404 });
  const token = (await cookies()).get(portalCookie(slug))?.value;
  if (!token) return new NextResponse(null, { status: 401 });
  const preview = new URL(request.url).searchParams.get("preview") === "1" ? "?preview=1" : "";
  const upstream = await fetch(businessApiUrl(`/client-portal/${slug}/files/${kind}/${id}${preview}`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
    .catch(() => null);
  if (!upstream?.ok || !upstream.body) return new NextResponse(null, { status: upstream?.status ?? 503 });
  return new NextResponse(upstream.body, { headers: {
    "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
    "content-disposition": upstream.headers.get("content-disposition") ?? "inline",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  } });
}
