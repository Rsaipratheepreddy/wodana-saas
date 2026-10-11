import { NextResponse } from "next/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
import { reminderApi } from "@/lib/reminders/contract";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ZONE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/;

/** The signed-in person's digest, quiet hours and time zone, with the firm's values they fall back to. */
export async function GET(request: Request) {
  const t = await getServerT();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  return workspaceJsonResponse(reminderApi.personSettings(workspaceId), { method: "GET" }, t("Notification settings didn't load."));
}

/** Saves the person's own digest, quiet hours and time zone (version-checked). */
export async function PUT(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const quiet = body?.quietHours as { start?: unknown; end?: unknown } | null | undefined;
  const quietHours = quiet === null ? null : quiet && TIME.test(String(quiet.start)) && TIME.test(String(quiet.end)) ? { start: quiet.start, end: quiet.end } : undefined;
  const valid = body && typeof body.digestEnabled === "boolean" && (body.digestTime === null || TIME.test(String(body.digestTime)))
    && quietHours !== undefined && (body.timeZone === null || (typeof body.timeZone === "string" && ZONE.test(body.timeZone))) && Number.isInteger(body.version);
  if (!valid) return invalidRequest(t("Check the details and try again."));
  const input = { digestEnabled: body.digestEnabled, digestTime: body.digestTime, quietHours, timeZone: body.timeZone, version: body.version };
  return workspaceJsonResponse(reminderApi.personSettings(workspaceId),
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, t("Could not save."));
}
