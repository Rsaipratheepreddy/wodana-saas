import { NextResponse } from "next/server";
import { businessApiUrl } from "@/lib/auth/server";
import { UUID } from "@/lib/workspace/workspace-api";

/** A business's logo or letterhead header as its documents print it (staff and client portal alike), like the workspace logo. */
export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string; assetId: string }> }) {
  const { workspaceId, assetId } = await context.params;
  if (!UUID.test(workspaceId) || !UUID.test(assetId)) return new NextResponse(null, { status: 404 });
  const upstream = await fetch(businessApiUrl(`/public/entity-images/${workspaceId}/${assetId}`), { cache: "no-store" }).catch(() => null);
  if (!upstream?.ok || !upstream.body) return new NextResponse(null, { status: upstream?.status ?? 404 });
  return new NextResponse(upstream.body, {
    headers: {
      "cache-control": upstream.headers.get("cache-control") ?? "public, max-age=3600",
      "content-type": upstream.headers.get("content-type") ?? "image/png",
      etag: upstream.headers.get("etag") ?? "",
    },
  });
}
