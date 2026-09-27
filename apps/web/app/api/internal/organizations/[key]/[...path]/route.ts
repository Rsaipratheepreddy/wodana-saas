import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

const KEY = /^[a-zA-Z0-9_-]{1,160}$/;
const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
type Method = "GET" | "POST" | "PATCH";
type Context = { params: Promise<{ key: string; path: string[] }> };

/** One organization's control-plane routes; anything else is refused before it reaches the API. */
const ROUTES: Array<{ method: Method; path: RegExp; key?: boolean }> = [
  { method: "GET", path: /^lifecycle$/ },
  { method: "POST", path: /^lifecycle\/transitions$/, key: true },
  { method: "GET", path: /^seats$/ },
  { method: "PATCH", path: /^seats$/ },
  { method: "GET", path: /^support-sessions$/ },
  { method: "POST", path: /^support-sessions$/, key: true },
  { method: "POST", path: new RegExp(`^support-sessions/${ID}/(approve|reject|start|revoke)$`, "i") },
  { method: "GET", path: /^support\/(members|activity)$/ },
  { method: "POST", path: new RegExp(`^domains/${ID}/(certificate|activate|rollback-complete)$`, "i") },
];

async function proxy(request: Request, context: Context, method: Method) {
  if (method !== "GET" && !isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { key, path } = await context.params;
  const joined = path.join("/");
  const route = ROUTES.find((candidate) => candidate.method === method && candidate.path.test(joined));
  if (!KEY.test(key) || !route) return invalidRequest("Choose a valid organization action.");
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["content-type"] = "application/json";
  if (route.key) {
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 160) return invalidRequest("A request key is required.");
    headers["idempotency-key"] = idempotencyKey;
  }
  return internalJsonResponse(`/internal/operator/organizations/${encodeURIComponent(key)}/${joined}`, {
    method, headers, ...(method === "GET" ? {} : { body: await request.text() }),
  }, method === "GET" ? "The organization could not be loaded." : "The change could not be saved.");
}

export function GET(request: Request, context: Context) {
  return proxy(request, context, "GET");
}

export function POST(request: Request, context: Context) {
  return proxy(request, context, "POST");
}

export function PATCH(request: Request, context: Context) {
  return proxy(request, context, "PATCH");
}
