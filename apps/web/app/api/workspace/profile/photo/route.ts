import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Upload (raw image body) or remove my profile photo. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return invalidRequest("This request must come from the workspace.");
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest("A valid workspace is required.");
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0];
  if (!TYPES.has(contentType)) return invalidRequest("Use a PNG, JPG or WebP photo.");
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return invalidRequest("Photo must be 5 MB or smaller.");
  return workspaceJsonResponse(`/workspaces/${workspaceId}/me/photo`, {
    method: "POST", headers: { "content-type": contentType, "content-length": String(body.byteLength) }, body,
  }, "The photo could not be uploaded.");
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return invalidRequest("This request must come from the workspace.");
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest("A valid workspace is required.");
  return workspaceJsonResponse(`/workspaces/${workspaceId}/me/photo`, { method: "DELETE" }, "The photo could not be removed.");
}

export const dynamic = "force-dynamic";
