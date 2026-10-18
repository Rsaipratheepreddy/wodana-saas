import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

const MODEL = /^[a-zA-Z0-9._:-]{1,120}$/;

/** Changes one model's list prices, margin or state (billing operators). */
export async function PATCH(request: Request, context: { params: Promise<{ model: string }> }) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { model } = await context.params;
  if (!MODEL.test(model)) return invalidRequest("Choose a valid model.");
  return internalJsonResponse(`/internal/operator/ai-credits/rates/${encodeURIComponent(model)}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: await request.text(),
  }, "The rate could not be saved.");
}
