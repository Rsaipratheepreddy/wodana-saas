import { internalJsonResponse } from "@/lib/internal/proxy";

export async function GET() {
  return internalJsonResponse("/internal/operator/tenant-drafts/setup-profiles", { method: "GET" }, "Setup options could not be loaded.");
}
