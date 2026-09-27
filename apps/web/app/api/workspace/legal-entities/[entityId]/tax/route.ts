import { NextResponse } from "next/server";
import { e2eTaxNumbering } from "@/lib/workspace/tax-numbering";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function PUT(request: Request, { params }: { params: Promise<{ entityId: string }> }) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const { entityId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId) || !UUID.test(entityId)) return invalidRequest(t("A valid workspace and legal entity are required."));
  const payload = { version: body?.version, pricesIncludeTax: body?.pricesIncludeTax, rates: body?.rates };
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    return NextResponse.json({ ...e2eTaxNumbering(entityId), tax: { version: 1, pricesIncludeTax: Boolean(payload.pricesIncludeTax), rates: payload.rates } });
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/legal-entities/${entityId}/tax`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  }, t("Tax settings could not be saved."));
}
