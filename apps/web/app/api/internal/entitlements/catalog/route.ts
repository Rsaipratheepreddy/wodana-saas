import { internalJsonResponse } from "@/lib/internal/proxy";
import { getServerT } from "@/lib/i18n/server";

export async function GET() {
  const t = await getServerT();
  return internalJsonResponse("/internal/operator/tenants/platform/entitlement-catalog", {
    method: "GET",
  }, t("The entitlement catalogue could not be loaded."));
}
