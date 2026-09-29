import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

const PROVIDERS = new Set(["meta", "intuit", "zoho", "google"]);

/** A safe live check of the provider's app credentials (nothing is sent to anyone). */
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { provider } = await context.params;
  if (!PROVIDERS.has(provider)) return invalidRequest("Choose a valid provider.");
  return internalJsonResponse(`/internal/operator/platform-integrations/${provider}/test`, { method: "POST" },
    "The check could not run.");
}
