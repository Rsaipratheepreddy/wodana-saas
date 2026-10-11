import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
import { DELIVERY_MESSAGE_STATUSES, reminderApi } from "@/lib/reminders/contract";

const CHANNELS = ["in_app", "push", "email", "whatsapp", "webhook"];
const DAY_OR_TIME = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;

/** Delivery health's message list: each notice with its channel, status, reason and attempts, newest first. */
export async function GET(request: Request) {
  const t = await getServerT();
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  const forwarded = new URLSearchParams();
  const status = params.get("status"), channel = params.get("channel"), from = params.get("from"), to = params.get("to"), cursor = params.get("cursor");
  const limit = Number(params.get("limit"));
  if (status && (DELIVERY_MESSAGE_STATUSES as readonly string[]).includes(status)) forwarded.set("status", status);
  if (channel && CHANNELS.includes(channel)) forwarded.set("channel", channel);
  if (from && DAY_OR_TIME.test(from)) forwarded.set("from", from);
  if (to && DAY_OR_TIME.test(to)) forwarded.set("to", to);
  if (cursor && cursor.length <= 500) forwarded.set("cursor", cursor);
  if (Number.isInteger(limit) && limit > 0) forwarded.set("limit", String(Math.min(limit, 200)));
  const query = forwarded.toString();
  return workspaceJsonResponse(`${reminderApi.healthMessages(workspaceId)}${query ? `?${query}` : ""}`, { method: "GET" }, t("Messages didn't load."));
}
