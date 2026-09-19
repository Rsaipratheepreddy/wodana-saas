import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

export async function POST(request: Request, context: RouteContext<"/api/internal/provisioning/drafts/[draftId]/provision">) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { draftId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) return invalidRequest("Choose a valid draft.");
  const key = request.headers.get("idempotency-key");
  if (!key || key.length > 160) return invalidRequest("A provisioning request key is required.");
  const body = await request.json().catch(() => null) as { expectedVersion?: unknown } | null;
  if (!body || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) return invalidRequest("The draft version is required.");
  return internalJsonResponse(`/internal/operator/tenant-drafts/${draftId}/provision`, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ expectedVersion: body.expectedVersion }),
  }, "The customer could not be provisioned.");
}
