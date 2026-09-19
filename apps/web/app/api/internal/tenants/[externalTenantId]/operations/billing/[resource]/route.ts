import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

const VALID_TENANT = /^[a-zA-Z0-9_-]{1,160}$/;
const METHODS = new Map([
  ["contract", "PATCH"],
  ["allocation", "PATCH"],
  ["collection", "PATCH"],
  ["usage-snapshots", "POST"],
]);

async function proxy(request: Request, context: { params: Promise<{ externalTenantId: string; resource: string }> }, method: "PATCH" | "POST") {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { externalTenantId, resource } = await context.params;
  if (!VALID_TENANT.test(externalTenantId) || METHODS.get(resource) !== method) {
    return invalidRequest("Choose a valid billing operation.");
  }
  return internalJsonResponse(
    `/internal/operator/tenants/${encodeURIComponent(externalTenantId)}/operations/billing/${resource}`,
    { method, headers: { "content-type": "application/json" }, body: await request.text() },
    "The billing operation could not be saved.",
  );
}

export function PATCH(request: Request, context: { params: Promise<{ externalTenantId: string; resource: string }> }) {
  return proxy(request, context, "PATCH");
}

export function POST(request: Request, context: { params: Promise<{ externalTenantId: string; resource: string }> }) {
  return proxy(request, context, "POST");
}
