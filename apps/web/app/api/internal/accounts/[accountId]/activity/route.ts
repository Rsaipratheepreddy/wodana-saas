import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest } from "@/lib/workspace/workspace-api";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params;
  if (!ID.test(accountId)) return invalidRequest("Choose a valid account.");
  return internalJsonResponse(`/internal/operator/accounts/${accountId}/activity`, { method: "GET" }, "Activity could not be loaded.");
}
