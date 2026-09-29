import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

export async function GET() {
  return internalJsonResponse("/internal/operator/sales-contact-form", { method: "GET" }, "The contact form could not be loaded.");
}

/** Saves a new version of the form; the request key makes a retried save land once. */
export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !/^[a-zA-Z0-9_-]{8,160}$/.test(idempotencyKey)) return invalidRequest("A request key is required.");
  const body = await request.text();
  if (body.length > 30_000) return invalidRequest("The form settings are too long.");
  return internalJsonResponse("/internal/operator/sales-contact-form", {
    method: "PUT", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body,
  }, "The contact form could not be saved.");
}
