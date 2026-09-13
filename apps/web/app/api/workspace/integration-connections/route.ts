import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const PROVIDERS = new Set(["google_workspace", "quickbooks", "zoho_books", "whatsapp", "payment", "custom"]);

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest("A valid workspace is required.");
  return workspaceJsonResponse(`/workspaces/${workspaceId}/integration-connections`, { method: "GET" }, "Connections could not be loaded.");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const provider = typeof body?.provider === "string" ? body.provider : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  if (!UUID.test(workspaceId)) return invalidRequest("A valid workspace is required.");
  if (!PROVIDERS.has(provider)) return invalidRequest("Select a valid integration provider.");
  if (displayName.length < 2 || displayName.length > 160) return invalidRequest("Connection name must be between 2 and 160 characters.");
  const payload = { ...body, workspaceId: undefined, displayName };
  return workspaceJsonResponse(`/workspaces/${workspaceId}/integration-connections`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, "The integration connection could not be created.");
}
