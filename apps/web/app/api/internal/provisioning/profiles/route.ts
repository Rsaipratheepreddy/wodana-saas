import { internalJsonResponse } from "@/lib/internal/proxy";
import { getServerT } from "@/lib/i18n/server";

export async function GET() {
  const t = await getServerT();
  return internalJsonResponse("/internal/operator/tenant-drafts/setup-profiles", { method: "GET" }, t("Setup options could not be loaded."));
}
