import { mcpMetadataPreflight, mcpMetadataResponse } from "@/lib/mcp/metadata.server";

/** OAuth authorization server metadata (RFC 8414) for AI apps connecting over MCP. */
export async function GET(request: Request) {
  return mcpMetadataResponse(request, "authorization-server");
}

export function OPTIONS() {
  return mcpMetadataPreflight();
}
