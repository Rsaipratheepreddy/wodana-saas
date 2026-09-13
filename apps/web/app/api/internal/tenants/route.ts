import { randomUUID } from "node:crypto";
import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const body = await request.text();
  return internalJsonResponse("/internal/tenants", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
    body,
  }, "The client could not be created.");
}
