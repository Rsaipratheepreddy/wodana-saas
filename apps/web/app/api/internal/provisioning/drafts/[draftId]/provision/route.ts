import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function POST(request: Request, context: RouteContext<"/api/internal/provisioning/drafts/[draftId]/provision">) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("The request origin is not allowed."));
  const { draftId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) return invalidRequest(t("Choose a valid draft."));
  const key = request.headers.get("idempotency-key");
  if (!key || key.length > 160) return invalidRequest(t("A provisioning request key is required."));
  const body = await request.json().catch(() => null) as { expectedVersion?: unknown } | null;
  if (!body || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) return invalidRequest(t("The draft version is required."));
  return internalJsonResponse(`/internal/operator/tenant-drafts/${draftId}/provision`, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ expectedVersion: body.expectedVersion }),
  }, t("The customer could not be provisioned."));
}
