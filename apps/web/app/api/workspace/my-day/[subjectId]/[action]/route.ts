import { NextResponse } from "next/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
import { reminderApi } from "@/lib/reminders/contract";

type Params = { params: Promise<{ subjectId: string; action: string }> };
const COMMANDS = ["snooze", "unsnooze", "complete", "reassign"] as const;
type Command = (typeof COMMANDS)[number];

const version = (value: unknown) => (Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null);

/** The body each My day command takes, or null when it is malformed (business-core checks the rest). */
function commandBody(command: Command, body: Record<string, unknown>): Record<string, unknown> | null {
  const current = version(body.version);
  if (current === null) return null;
  if (command === "snooze") {
    const until = typeof body.until === "string" && !Number.isNaN(Date.parse(body.until)) ? body.until : null;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    return until && reason && reason.length <= 300 ? { until, reason, version: current } : null;
  }
  if (command === "reassign") return typeof body.membershipId === "string" && UUID.test(body.membershipId) ? { membershipId: body.membershipId, version: current } : null;
  return { version: current };
}

/** The people a My day item can be handed to. */
export async function GET(request: Request, { params }: Params) {
  const t = await getServerT();
  const { subjectId, action } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (action !== "assignees") return NextResponse.json({ message: t("Not found") }, { status: 404 });
  if (!UUID.test(workspaceId) || !UUID.test(subjectId)) return invalidRequest(t("A valid workspace is required."));
  return workspaceJsonResponse(reminderApi.assignees(workspaceId, subjectId), { method: "GET" }, t("The people could not be loaded."));
}

/** Snooze, wake, mark done (the module's own command) or reassign a My day item, version-checked. */
export async function POST(request: Request, { params }: Params) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const { subjectId, action } = await params;
  if (!(COMMANDS as readonly string[]).includes(action)) return NextResponse.json({ message: t("Not found") }, { status: 404 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(subjectId)) return invalidRequest(t("A valid workspace is required."));
  const raw = await request.json().catch(() => null) as unknown;
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? commandBody(action as Command, raw as Record<string, unknown>) : null;
  if (!body) return invalidRequest(t("Check the details and try again."));
  return workspaceJsonResponse(`/workspaces/${workspaceId}/my-day/${subjectId}/${action}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, t("The change could not be saved."));
}
