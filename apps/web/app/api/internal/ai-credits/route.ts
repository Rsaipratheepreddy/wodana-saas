import { internalJsonResponse } from "@/lib/internal/proxy";

/** Every organization's AI credits and today's platform-wide use against the daily cap. */
export async function GET() {
  return internalJsonResponse("/internal/operator/ai-credits", { method: "GET" }, "AI credits could not be loaded.");
}
