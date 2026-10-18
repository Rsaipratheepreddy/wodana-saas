import { NextResponse } from "next/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
import { reminderApi } from "@/lib/reminders/contract";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const hours = (value: unknown) => value && typeof value === "object" && TIME.test(String((value as { start?: unknown }).start)) && TIME.test(String((value as { end?: unknown }).end))
  ? { start: String((value as { start: string }).start), end: String((value as { end: string }).end) } : null;

/** Settings › Reminders: the firm's defaults and one rule per reminder kind (reminders.manage). */
export async function GET(request: Request) {
  const t = await getServerT();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  return workspaceJsonResponse(reminderApi.settings(workspaceId), { method: "GET" }, t("Reminder settings didn't load."));
}

/** The firm's quiet hours, digest time, client window and whether critical reminders break quiet hours. */
export async function PUT(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const valid = body && TIME.test(String(body.quietStart)) && TIME.test(String(body.quietEnd)) && TIME.test(String(body.digestTime))
    && (body.clientWindow === null || hours(body.clientWindow)) && typeof body.criticalBreaksQuiet === "boolean" && Number.isInteger(body.version);
  if (!valid) return invalidRequest(t("Check the details and try again."));
  const settings = { quietStart: body.quietStart, quietEnd: body.quietEnd, digestTime: body.digestTime, clientWindow: body.clientWindow === null ? null : hours(body.clientWindow), criticalBreaksQuiet: body.criticalBreaksQuiet, version: body.version };
  return workspaceJsonResponse(reminderApi.settings(workspaceId),
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) }, t("Reminder settings could not be saved."));
}
