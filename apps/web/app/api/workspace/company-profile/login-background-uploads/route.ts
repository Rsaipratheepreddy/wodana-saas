import { NextResponse } from "next/server";
import { getServerT } from "@/lib/i18n/server";
import { proxyBrandImageCommand, UUID } from "@/lib/workspace/brand-image-proxy";

export async function POST(request: Request) {
  const t = await getServerT();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId)) return NextResponse.json({ message: t("A valid workspace is required.") }, { status: 400 });
  return proxyBrandImageCommand(`/workspaces/${workspaceId}/company-profile/login-background-uploads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: body?.filename, mimeType: body?.mimeType, byteSize: body?.byteSize }),
  }, {
    expired: t("Your session has expired. Sign in again."),
    unavailable: t("Sign-in background uploads are unavailable."),
    failed: t("The sign-in background upload could not be started."),
  });
}
