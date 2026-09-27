import { NextResponse } from "next/server";
import { ACTIVE_WORKSPACE_COOKIE, authCookieOptions } from "@/lib/auth/server";
import { UUID, invalidRequest, isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function POST(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Invalid request origin.") }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!UUID.test(body?.workspaceId ?? "")) return invalidRequest(t("Choose a valid workspace."));
  const upstream = await workspaceJsonResponse("/me", { method: "GET" }, t("Workspace access could not be checked."));
  if (!upstream.ok) return upstream;
  const profile = await upstream.json();
  if (!profile.memberships?.some((item: { workspaceId: string }) => item.workspaceId === body.workspaceId)) return NextResponse.json({ message: t("You do not have access to this workspace.") }, { status: 403 });
  const response = NextResponse.json({ workspaceId: body.workspaceId }, { headers: { "cache-control": "no-store" } });
  for (const cookie of upstream.cookies.getAll()) response.cookies.set(cookie);
  response.cookies.set(ACTIVE_WORKSPACE_COOKIE, body.workspaceId, authCookieOptions);
  return response;
}
