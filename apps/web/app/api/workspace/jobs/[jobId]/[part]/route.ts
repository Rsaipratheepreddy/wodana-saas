import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

/** The parts of a job the quick panel reads without leaving the page: its journey, money and documents. Read only. */
const PARTS = new Set(["journey", "money", "documents"]);

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string; part: string }> }) {
  const t = await getServerT();
  const { jobId, part } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(jobId) || !PARTS.has(part)) return invalidRequest(t("Invalid request."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/jobs/${jobId}/${part}`, { method: "GET" }, t("Could not load."));
}
