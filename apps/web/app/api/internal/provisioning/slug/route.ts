import { internalJsonResponse } from "@/lib/internal/proxy";
import { invalidRequest } from "@/lib/workspace/workspace-api";

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  if (!/^[a-z0-9-]{1,70}$/.test(slug)) return invalidRequest("Use lowercase letters, numbers and single hyphens.");
  return internalJsonResponse(`/internal/operator/accounts/slug-availability?slug=${encodeURIComponent(slug)}`, { method: "GET" },
    "The login address could not be checked.");
}
