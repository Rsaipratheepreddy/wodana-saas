import { randomUUID } from "node:crypto";
import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!input) return invalidRequest("Enter valid tenant details.");
  const requestedKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey : "";
  const idempotencyKey = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedKey)
    ? requestedKey
    : randomUUID();
  const tenant = { ...input };
  delete tenant.idempotencyKey;
  return internalJsonResponse("/internal/operator/tenants", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(tenant),
  }, "The client could not be created.");
}
