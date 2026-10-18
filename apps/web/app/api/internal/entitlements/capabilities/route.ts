import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function PATCH(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("The request origin is not allowed."));
  return internalJsonResponse("/internal/operator/tenants/platform/capabilities", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  }, t("The capability state could not be saved."));
}
