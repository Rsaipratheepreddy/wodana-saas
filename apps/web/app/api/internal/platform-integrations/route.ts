import { internalJsonResponse } from "@/lib/internal/proxy";

/** Wodana's own app credentials per provider: values, "set · last 4" for secrets, status and the URLs to register. */
export async function GET() {
  return internalJsonResponse("/internal/operator/platform-integrations", { method: "GET" }, "Platform connections could not be loaded.");
}
