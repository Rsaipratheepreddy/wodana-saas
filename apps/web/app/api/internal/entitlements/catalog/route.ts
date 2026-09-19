import { internalJsonResponse } from "@/lib/internal/proxy";

export async function GET() {
  return internalJsonResponse("/internal/operator/tenants/platform/entitlement-catalog", {
    method: "GET",
  }, "The entitlement catalogue could not be loaded.");
}
