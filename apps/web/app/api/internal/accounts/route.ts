import { internalJsonResponse } from "@/lib/internal/proxy";

export async function GET() {
  return internalJsonResponse("/internal/operator/accounts", { method: "GET" }, "Accounts could not be loaded.");
}
