import { internalJsonResponse } from "@/lib/internal/proxy";

export async function GET() {
  return internalJsonResponse("/internal/operator/sales-enquiries/assignees", { method: "GET" }, "Operators could not be loaded.");
}
