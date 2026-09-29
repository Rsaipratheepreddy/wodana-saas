import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin, UUID } from "@/lib/workspace/workspace-api";

const ACTIONS = new Set(["status", "assignee", "notes"]);

/** One enquiry's commands: status, assignee and notes. Anything else is refused before it reaches the API. */
export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { id, action } = await context.params;
  if (!UUID.test(id) || !ACTIONS.has(action)) return invalidRequest("Choose a valid enquiry action.");
  const body = await request.text();
  if (body.length > 10_000) return invalidRequest("The change is too long.");
  return internalJsonResponse(`/internal/operator/sales-enquiries/${id}/${action}`, {
    method: "POST", headers: { "content-type": "application/json" }, body,
  }, "The change could not be saved.");
}
