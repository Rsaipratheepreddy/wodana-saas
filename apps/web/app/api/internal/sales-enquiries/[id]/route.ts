import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, UUID } from "@/lib/workspace/workspace-api";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return invalidRequest("Choose a valid enquiry.");
  return internalJsonResponse(`/internal/operator/sales-enquiries/${id}`, { method: "GET" }, "The enquiry could not be loaded.");
}
