import { NextResponse } from "next/server";
import { e2eTaxNumbering } from "@/lib/workspace/tax-numbering";
import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

export async function GET(request: Request, { params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(entityId)) return invalidRequest("A valid workspace and legal entity are required.");
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") return NextResponse.json(e2eTaxNumbering(entityId));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/legal-entities/${entityId}/tax-numbering`, { method: "GET" }, "Tax and numbering could not be loaded.");
}
