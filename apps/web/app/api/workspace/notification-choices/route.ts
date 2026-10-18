import { NextResponse } from "next/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
import { NOTICE_CHANNELS, NOTIFICATION_MODULES } from "@/lib/workspace/notification-modules";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ZONE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/;
const GROUPS = new Set<string>(NOTIFICATION_MODULES.map((module) => module.id));
const CHANNELS = new Set<string>(NOTICE_CHANNELS);
const path = (workspaceId: string) => `/workspaces/${workspaceId}/notification-choices/me`;

/** The signed-in person's channels per group, quiet hours, digest and zone, with the channels the workspace has turned on. */
export async function GET(request: Request) {
  const t = await getServerT();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  return workspaceJsonResponse(path(workspaceId), { method: "GET" }, t("Notification settings didn't load."));
}

/** Saves them in one version-checked command. */
export async function PUT(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const quiet = body?.quietHours as { start?: unknown; end?: unknown } | null | undefined;
  const quietHours = quiet === null ? null : quiet && TIME.test(String(quiet.start)) && TIME.test(String(quiet.end)) ? { start: quiet.start, end: quiet.end } : undefined;
  const cells = Array.isArray(body?.choices) && body.choices.length <= GROUPS.size * CHANNELS.size
    ? (body.choices as Array<Record<string, unknown>>).filter((cell) => GROUPS.has(String(cell?.group)) && CHANNELS.has(String(cell?.channel)) && typeof cell?.enabled === "boolean")
      .map((cell) => ({ group: cell.group, channel: cell.channel, enabled: cell.enabled }))
    : null;
  const valid = body && cells && cells.length === (body.choices as unknown[]).length && typeof body.digestEnabled === "boolean"
    && (body.digestTime === null || TIME.test(String(body.digestTime))) && quietHours !== undefined
    && (body.timeZone === null || (typeof body.timeZone === "string" && ZONE.test(body.timeZone))) && Number.isInteger(body.version);
  if (!valid) return invalidRequest(t("Check the details and try again."));
  const input = { choices: cells, quietHours, digestEnabled: body.digestEnabled, digestTime: body.digestTime, timeZone: body.timeZone, version: body.version };
  return workspaceJsonResponse(path(workspaceId), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, t("Could not save."));
}
