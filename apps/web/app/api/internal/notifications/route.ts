import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

/** The signed-in operator's notices in Wodana Control. */
export async function GET() {
  return internalJsonResponse("/internal/operator/notifications", { method: "GET" }, "Notifications could not be loaded.");
}

/** Marks notices read: `{ ids }` or `{ all: true }`. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const body = await request.text();
  if (body.length > 10_000) return invalidRequest("The request is too long.");
  return internalJsonResponse("/internal/operator/notifications/read", {
    method: "POST", headers: { "content-type": "application/json" }, body,
  }, "Notifications could not be updated.");
}
