import { NextResponse } from "next/server";
import { businessApiUrl } from "@/lib/auth/server";

/** A tenant's own sign-in background, public by login slug (as its logo is); 404 when it has none. */
export async function GET(_request: Request, context: { params: Promise<{ loginSlug: string }> }) {
  const { loginSlug } = await context.params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(loginSlug)) return new NextResponse(null, { status: 404 });
  const upstream = await fetch(businessApiUrl(`/public/tenant-branding/${loginSlug}/login-background`), { cache: "no-store" }).catch(() => null);
  if (!upstream?.ok || !upstream.body) return new NextResponse(null, { status: upstream?.status ?? 404 });
  return new NextResponse(upstream.body, {
    headers: {
      "cache-control": upstream.headers.get("cache-control") ?? "public, max-age=3600",
      "content-type": upstream.headers.get("content-type") ?? "image/webp",
      etag: upstream.headers.get("etag") ?? "",
    },
  });
}
