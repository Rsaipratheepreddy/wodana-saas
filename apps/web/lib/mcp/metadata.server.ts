import "server-only";

import { NextResponse } from "next/server";
import { businessApiUrl } from "@/lib/auth/server";

/**
 * The address the browser or AI app used, for Business Core to name its issuer and endpoints after:
 * the incoming Host and scheme (a proxy's `x-forwarded-proto` when there is one).
 */
export function forwardedOriginHeaders(request: Request): Record<string, string> {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  return { "x-forwarded-host": host, "x-forwarded-proto": proto };
}

/** Public metadata: any AI app may read it from a browser (no cookies are involved). */
const PUBLIC_READ = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
};

/**
 * OAuth metadata for AI apps (MCP): the authorization server (RFC 8414) and the protected resource
 * (RFC 9728), served at the host's `/.well-known/` and answered by Business Core as they are.
 */
export async function mcpMetadataResponse(request: Request, document: "authorization-server" | "protected-resource"): Promise<NextResponse> {
  const upstream = await fetch(businessApiUrl(`/mcp/oauth/${document}`), {
    headers: { accept: "application/json", ...forwardedOriginHeaders(request) },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const payload = upstream ? await upstream.json().catch(() => null) : null;
  const response = upstream && payload !== null
    ? NextResponse.json(payload, { status: upstream.status })
    : NextResponse.json({ error: "temporarily_unavailable" }, { status: 503 });
  response.headers.set("cache-control", "no-store");
  response.headers.set("content-type", "application/json");
  for (const [name, value] of Object.entries(PUBLIC_READ)) response.headers.set(name, value);
  return response;
}

/** The browser's preflight for the metadata (an AI app may send its protocol version header). */
export function mcpMetadataPreflight(): Response {
  return new Response(null, { status: 204, headers: { ...PUBLIC_READ, "access-control-max-age": "86400" } });
}
