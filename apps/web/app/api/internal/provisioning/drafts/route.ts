import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const key = request.headers.get("idempotency-key");
  if (!key || key.length > 160) return invalidRequest("A provisioning request key is required.");
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalidRequest("Enter valid customer details.");
  return internalJsonResponse("/internal/operator/tenant-drafts", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body),
  }, "The provisioning draft could not be saved.");
}
