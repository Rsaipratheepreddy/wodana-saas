import { internalJsonResponse } from "@/lib/internal/proxy";

/** The platform's AI model rates (list price × margin, in credits per million tokens) and the model in use. */
export async function GET() {
  return internalJsonResponse("/internal/operator/ai-credits/rates", { method: "GET" }, "Model rates could not be loaded.");
}
