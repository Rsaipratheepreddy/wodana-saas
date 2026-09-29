import { NextResponse } from "next/server";
import { mcpMetadataPreflight, mcpMetadataResponse } from "@/lib/mcp/metadata.server";

type Params = { params: Promise<{ resource?: string[] }> };

/** The protected resources: the host itself and the MCP endpoint (`/api/v1/mcp`). */
const RESOURCES = new Set(["", "api/v1/mcp"]);

/** OAuth protected resource metadata (RFC 9728) for the MCP endpoint. */
export async function GET(request: Request, { params }: Params) {
  const { resource = [] } = await params;
  if (!RESOURCES.has(resource.join("/"))) return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  return mcpMetadataResponse(request, "protected-resource");
}

export function OPTIONS() {
  return mcpMetadataPreflight();
}
