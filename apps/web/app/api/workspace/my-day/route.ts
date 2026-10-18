import type { MyDayQuery } from "@wodana/contracts";
import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";
import { MY_DAY_SCOPES, MY_DAY_URGENCIES, REMINDER_MODULES, reminderApi } from "@/lib/reminders/contract";

const oneOf = <T extends string>(values: readonly T[], value: string | null): T | undefined => (value && (values as readonly string[]).includes(value) ? value as T : undefined);

/** My day for the signed-in person (or their team): business-core filters every item by permission. */
export async function GET(request: Request) {
  const t = await getServerT();
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  const limit = Number(params.get("limit"));
  const filter: MyDayQuery = {
    scope: oneOf(MY_DAY_SCOPES, params.get("scope")),
    urgency: oneOf(MY_DAY_URGENCIES, params.get("urgency")),
    module: oneOf(REMINDER_MODULES, params.get("module")),
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : undefined,
  };
  return workspaceJsonResponse(reminderApi.myDay(workspaceId, filter), { method: "GET" }, t("My day could not be loaded."));
}
