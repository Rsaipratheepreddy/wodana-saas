import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { safeBackendMessage } from "@/lib/auth/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX = /^#[0-9A-F]{6}$/;

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const primaryColor = typeof body?.primaryColor === "string"
    ? body.primaryColor.trim().toUpperCase()
    : body?.primaryColor;
  if (!UUID.test(workspaceId)) {
    return NextResponse.json({ message: "A valid workspace is required." }, { status: 400 });
  }
  if (!Number.isInteger(body?.workspaceVersion) || Number(body?.workspaceVersion) < 1) {
    return NextResponse.json({ message: "A valid workspace version is required." }, { status: 400 });
  }
  if (primaryColor !== null && (typeof primaryColor !== "string" || !HEX.test(primaryColor))) {
    return NextResponse.json({ message: "Choose a valid six-digit colour." }, { status: 400 });
  }

  const result = await authenticatedBackendFetch(`/workspaces/${workspaceId}/appearance`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceVersion: body?.workspaceVersion, primaryColor }),
  });
  if (result.unauthenticated) {
    const response = NextResponse.json({ message: "Your session has expired. Sign in again." }, { status: 401 });
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!result.upstream) {
    return NextResponse.json({ message: "The workspace appearance service is unavailable." }, { status: 503 });
  }
  const payload = await result.upstream.json().catch(() => null);
  const response = NextResponse.json(
    result.upstream.ok
      ? payload
      : { message: safeBackendMessage(payload, "The workspace appearance could not be saved.") },
    { status: result.upstream.status },
  );
  applyRotatedSession(response, result.rotatedSession);
  response.headers.set("cache-control", "no-store");
  return response;
}
