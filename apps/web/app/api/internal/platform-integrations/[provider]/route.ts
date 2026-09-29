import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

const PROVIDERS = new Set(["platform", "meta", "intuit", "zoho", "google"]);

/** Saves one provider's credentials; the request key makes a retried save land once. Secrets are never echoed. */
export async function PUT(request: Request, context: { params: Promise<{ provider: string }> }) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { provider } = await context.params;
  if (!PROVIDERS.has(provider)) return invalidRequest("Choose a valid provider.");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !/^[a-zA-Z0-9_-]{8,160}$/.test(idempotencyKey)) return invalidRequest("A request key is required.");
  const body = await request.text();
  if (body.length > 4_000) return invalidRequest("The credentials are too long.");
  return internalJsonResponse(`/internal/operator/platform-integrations/${provider}`, {
    method: "PUT", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body,
  }, "The credentials could not be saved.");
}
