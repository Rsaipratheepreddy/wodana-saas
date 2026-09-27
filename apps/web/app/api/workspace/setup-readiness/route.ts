import { NextResponse } from "next/server";
import { invalidRequest, UUID } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
import { getSetupReadiness } from "@/lib/workspace/setup-readiness.server";

/** The workspace setup progress shown around the avatar; only owners and administrators get it. */
export async function GET(request: Request) {
  const t = await getServerT();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  const readiness = await getSetupReadiness(workspaceId);
  if (!readiness) return NextResponse.json({ message: t("Only workspace owners and administrators can set up the workspace.") }, { status: 403 });
  return NextResponse.json(readiness, { headers: { "cache-control": "no-store" } });
}
