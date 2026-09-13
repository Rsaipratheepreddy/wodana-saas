import "server-only";
import { NextResponse } from "next/server";
import {
  applyRotatedSession,
  authenticatedBackendFetch,
} from "@/lib/auth/backend-session";
import { safeBackendMessage } from "@/lib/auth/server";
import {
  invalidRequest,
  isSameOrigin,
  UUID,
} from "@/lib/workspace/workspace-api";
import { allowedHrmsRoute, allowedProjectsRoute } from "./routes";
export async function hrmsProxy(
  request: Request,
  path: string[],
  area: "hrms" | "projects",
) {
  const resource = path.join("/");
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get("workspaceId") ?? "";
  if (
    !UUID.test(workspaceId) ||
    !(area === "hrms" ? allowedHrmsRoute : allowedProjectsRoute)(
      request.method,
      resource,
    )
  )
    return invalidRequest("Invalid HRMS resource.");
  query.delete("workspaceId");
  if (query.toString().length > 2000)
    return invalidRequest("The filter is too long.");
  if (request.method !== "GET" && !isSameOrigin(request))
    return NextResponse.json(
      { message: "This request must come from your workspace." },
      { status: 403 },
    );
  let body: BodyInit | undefined;
  const headers = new Headers();
  if (request.method !== "GET") {
    const multipart = request.headers
      .get("content-type")
      ?.startsWith("multipart/form-data");
    if (multipart) {
      if (!/^captures\/[0-9a-f-]{36}\/photo$/.test(resource))
        return invalidRequest("Unexpected photo upload.");
      if (Number(request.headers.get("content-length")) > 7 * 1024 * 1024)
        return invalidRequest("Photo is too large.");
      try {
        body = await request.formData();
      } catch {
        return invalidRequest("Invalid photo upload.");
      }
      const file = body.get("photo");
      if (!(file instanceof File) || file.size > 6 * 1024 * 1024)
        return invalidRequest("Capture an image up to 6 MB.");
    } else {
      const text = await request.text();
      if (text.length > 32000) return invalidRequest("Request is too large.");
      try {
        JSON.parse(text);
      } catch {
        return invalidRequest("Invalid JSON request.");
      }
      headers.set("content-type", "application/json");
      body = text;
    }
  }
  const result = await authenticatedBackendFetch(
    `/workspaces/${workspaceId}/${area}${resource ? `/${resource}` : ""}${query.size ? `?${query}` : ""}`,
    { method: request.method, headers, body },
  );
  let response: NextResponse;
  if (result.unauthenticated)
    response = NextResponse.json(
      { message: "Your session expired. Sign in again." },
      { status: 401 },
    );
  else if (!result.upstream)
    response = NextResponse.json(
      {
        message:
          "The attendance service is unavailable. Your pending capture is kept for retry.",
      },
      { status: 503 },
    );
  else if (
    result.upstream.ok &&
    ((resource.endsWith("/photo") && request.method === "GET") ||
      resource === "attendance/export")
  )
    response = new NextResponse(result.upstream.body, {
      status: result.upstream.status,
      headers: {
        "content-type":
          result.upstream.headers.get("content-type") ??
          "application/octet-stream",
        "content-disposition":
          result.upstream.headers.get("content-disposition") ?? "inline",
      },
    });
  else {
    const payload = await result.upstream.json().catch(() => null);
    response = NextResponse.json(
      result.upstream.ok
        ? payload
        : {
            message: safeBackendMessage(
              payload,
              "The request could not be completed.",
            ),
            issues: payload?.issues,
          },
      { status: result.upstream.status },
    );
  }
  response.headers.set("cache-control", "private, no-store");
  applyRotatedSession(response, result.rotatedSession);
  return response;
}
