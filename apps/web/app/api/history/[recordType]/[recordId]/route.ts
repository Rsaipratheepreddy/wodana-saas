import { NextResponse } from "next/server";
import { HISTORY_FILTERS, HISTORY_RECORD_TYPES } from "@wodana/contracts/history";
import { getServerT } from "@/lib/i18n/server";
import { UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const CURSOR = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[0-9a-f-]{36}$/i;

/** A record's history (who did what, when), read through the person's session. */
export async function GET(request: Request, { params }: { params: Promise<{ recordType: string; recordId: string }> }) {
  const t = await getServerT();
  const { recordType, recordId } = await params;
  const search = new URL(request.url).searchParams;
  const workspaceId = search.get("workspaceId") ?? "";
  const filter = search.get("filter") ?? "all";
  const before = search.get("before") ?? "";
  if (!UUID.test(workspaceId) || !/^[0-9a-f-]{36}$/i.test(recordId) || !(HISTORY_RECORD_TYPES as readonly string[]).includes(recordType)
    || !(HISTORY_FILTERS as readonly string[]).includes(filter) || (before && !CURSOR.test(before)))
    return NextResponse.json({ message: t("This history can't be shown.") }, { status: 400 });
  const query = new URLSearchParams({ filter, ...(before ? { before } : {}) });
  return workspaceJsonResponse(`/workspaces/${workspaceId}/history/${recordType}/${recordId}?${query}`, { method: "GET", cache: "no-store" }, t("The history didn't load."));
}
