import { internalJsonResponse } from "@/lib/internal/proxy";

export async function GET() {
  return internalJsonResponse("/internal/operator/sales-enquiries", { method: "GET" }, "Sales enquiries could not be loaded.");
}
