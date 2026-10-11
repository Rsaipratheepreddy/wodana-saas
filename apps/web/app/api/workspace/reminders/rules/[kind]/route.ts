import { NextResponse } from "next/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
import { isEngineReminderKind, REMINDER_CHAIN_LINKS, REMINDER_CHANNELS, REMINDER_RULE_LIMITS, reminderApi } from "@/lib/reminders/contract";

type Params = { params: Promise<{ kind: string }> };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const listOf = (values: readonly string[], value: unknown, max: number) =>
  Array.isArray(value) && value.length <= max && value.every((item) => typeof item === "string" && values.includes(item)) && new Set(value).size === value.length ? value as string[] : null;

/** A rule as the form sent it, or null when its shape is wrong (business-core checks the limits and critical kinds). */
function ruleInput(body: Record<string, unknown>) {
  const unit = body.unit === "day" || body.unit === "hour" ? body.unit : null;
  const offsets = Array.isArray(body.offsets) && body.offsets.length >= 1 && body.offsets.length <= REMINDER_RULE_LIMITS.maxOffsets
    && body.offsets.every((value) => Number.isInteger(value)) ? body.offsets as number[] : null;
  const escalateAfter = body.escalateAfter === null ? null : Number.isInteger(body.escalateAfter) ? body.escalateAfter as number : undefined;
  const chain = listOf(REMINDER_CHAIN_LINKS, body.chain, REMINDER_RULE_LIMITS.maxChain);
  const channels = listOf(REMINDER_CHANNELS, body.channels, REMINDER_CHANNELS.length);
  const quiet = body.quietHours as { start?: unknown; end?: unknown } | null | undefined;
  const quietHours = quiet === null || quiet === undefined ? null : TIME.test(String(quiet.start)) && TIME.test(String(quiet.end)) ? { start: quiet.start, end: quiet.end } : undefined;
  if (!unit || !offsets || escalateAfter === undefined || !chain || !channels?.length || quietHours === undefined) return null;
  if (typeof body.enabled !== "boolean" || typeof body.workingDays !== "boolean" || typeof body.digest !== "boolean" || !Number.isInteger(body.version)) return null;
  return { enabled: body.enabled, offsets, unit, workingDays: body.workingDays, escalateAfter, chain, channels, digest: body.digest, quietHours, version: body.version };
}

async function context(request: Request, params: Params["params"]) {
  const t = await getServerT();
  const { kind } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  return { t, kind, workspaceId, valid: UUID.test(workspaceId) && isEngineReminderKind(kind) };
}

/** Saves one kind's cadence, escalation, channels and digest for the firm (version 0 when it was the default). */
export async function PUT(request: Request, { params }: Params) {
  const { t, kind, workspaceId, valid } = await context(request, params);
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  if (!valid || !isEngineReminderKind(kind)) return invalidRequest(t("A valid workspace is required."));
  const body = await request.json().catch(() => null) as unknown;
  const input = body && typeof body === "object" && !Array.isArray(body) ? ruleInput(body as Record<string, unknown>) : null;
  if (!input) return invalidRequest(t("Check the details and try again."));
  return workspaceJsonResponse(reminderApi.rule(workspaceId, kind),
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, t("The reminder could not be saved."));
}

/** Puts a kind back to the default cadence. */
export async function DELETE(request: Request, { params }: Params) {
  const { t, kind, workspaceId, valid } = await context(request, params);
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Use your workspace to make this change.") }, { status: 403 });
  const version = Number(new URL(request.url).searchParams.get("version"));
  if (!valid || !isEngineReminderKind(kind) || !Number.isInteger(version) || version < 0) return invalidRequest(t("A valid workspace is required."));
  return workspaceJsonResponse(`${reminderApi.rule(workspaceId, kind)}?version=${version}`, { method: "DELETE" }, t("The reminder could not be reset."));
}
