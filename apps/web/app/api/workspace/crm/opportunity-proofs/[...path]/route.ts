import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const KINDS = new Set(["receipt", "card_slip", "bank_transfer", "cash_sheet", "photo", "other"]);

/** PLM-122: attach a payment proof to an opportunity (it wins it), or open one. */
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !path.length || path.length > 2 || !path.every((id) => UUID.test(id))) return invalidRequest(t("Invalid payment proof."));
  const [opportunityId, proofId] = path;
  if (request.method === "GET") {
    if (!proofId) return invalidRequest(t("Invalid payment proof."));
    const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/crm/opportunities/${opportunityId}/payment-proofs/${proofId}${query.get("preview") === "1" ? "?preview=1" : ""}`, { cache: "no-store" });
    if (result.unauthenticated || !result.upstream?.ok) {
      const response = NextResponse.json({ message: result.unauthenticated ? t("Sign in again to open this file.") : t("The file could not be loaded.") }, { status: result.unauthenticated ? 401 : result.upstream?.status ?? 503 });
      applyRotatedSession(response, result.rotatedSession);
      return response;
    }
    const response = new NextResponse(result.upstream.body, { status: 200, headers: {
      "content-type": result.upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": result.upstream.headers.get("content-disposition") ?? "attachment",
      "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'",
    } });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (proofId) return invalidRequest(t("Invalid payment proof."));
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return invalidRequest(t("Choose a file up to 20 MB."));
  try {
    const input = await request.formData();
    const file = input.get("file"), kind = String(input.get("kind") ?? ""), version = String(input.get("version") ?? ""), note = String(input.get("note") ?? "");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024) return invalidRequest(t("Choose an image or PDF up to 20 MB."));
    if (!KINDS.has(kind) || !/^[1-9]\d{0,9}$/.test(version) || note.length > 1000) return invalidRequest(t("Invalid payment proof."));
    const body = new FormData();
    body.set("version", version);
    body.set("kind", kind);
    if (note.trim()) body.set("note", note.trim());
    body.set("file", file);
    return workspaceJsonResponse(`/workspaces/${workspaceId}/crm/opportunities/${opportunityId}/payment-proofs`, { method: "POST", body }, t("The payment proof could not be attached."));
  } catch { return invalidRequest(t("Choose a valid file.")); }
}

export { handle as GET, handle as POST };
