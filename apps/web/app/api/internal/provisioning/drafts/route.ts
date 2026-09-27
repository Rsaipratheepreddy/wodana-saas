import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function POST(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("The request origin is not allowed."));
  const key = request.headers.get("idempotency-key");
  if (!key || key.length > 160) return invalidRequest(t("A provisioning request key is required."));
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalidRequest(t("Enter valid customer details."));
  return internalJsonResponse("/internal/operator/tenant-drafts", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body),
  }, t("The provisioning draft could not be saved."));
}
