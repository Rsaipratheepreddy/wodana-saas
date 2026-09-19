import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  return internalJsonResponse("/internal/operator/tenants/platform/capabilities", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  }, "The capability state could not be saved.");
}
