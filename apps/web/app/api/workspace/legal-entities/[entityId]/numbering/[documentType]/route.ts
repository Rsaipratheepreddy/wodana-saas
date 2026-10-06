import { NextResponse } from "next/server";
import { e2eTaxNumbering } from "@/lib/workspace/tax-numbering";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const TYPES = new Set(["QUOTATION", "INVOICE", "PURCHASE_ORDER"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ entityId: string; documentType: string }> }) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const { entityId, documentType } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId) || !UUID.test(entityId) || !TYPES.has(documentType)) return invalidRequest(t("A valid workspace, legal entity and document type are required."));
  const payload = { version: body?.version, prefix: body?.prefix, suffix: body?.suffix, padding: body?.padding, resetPolicy: body?.resetPolicy, nextNumber: body?.nextNumber };
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") return NextResponse.json(e2eTaxNumbering(entityId));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/legal-entities/${entityId}/numbering/${documentType}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  }, t("Numbering could not be saved."));
}
