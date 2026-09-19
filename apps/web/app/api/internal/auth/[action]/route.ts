import { NextResponse } from "next/server";
import { businessApiUrl, safeBackendMessage } from "@/lib/auth/server";
import { forwardedDeviceHeaders } from "@/lib/auth/device-request";
import { getOperatorSession, OPERATOR_COOKIE, operatorCookieOptions } from "@/lib/internal/auth";
import { invalidRequest, isSameOrigin } from "@/lib/workspace/workspace-api";

const actions = {
  login: "/auth/platform/login",
  setup: "/auth/platform/mfa/setup",
  confirm: "/auth/platform/mfa/confirm",
  verify: "/auth/platform/mfa/verify",
} as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const { action } = await context.params;
  if (action === "logout") {
    const session = await getOperatorSession();
    if (session) {
      await fetch(businessApiUrl("/auth/platform/logout"), {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}` },
        cache: "no-store",
      }).catch(() => null);
    }
    const response = NextResponse.json({ signedOut: true });
    response.cookies.delete(OPERATOR_COOKIE);
    response.headers.set("cache-control", "no-store");
    return response;
  }
  const path = actions[action as keyof typeof actions];
  if (!path) return NextResponse.json({ message: "Unknown sign-in action." }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return invalidRequest("Enter valid sign-in details.");
  const upstream = await fetch(businessApiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", ...forwardedDeviceHeaders(request.headers) },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: "Sign-in is temporarily unavailable." }, { status: 503 });
  const payload = await upstream.json().catch(() => null) as Record<string, unknown> | null;
  if (!upstream.ok) {
    return NextResponse.json(
      { message: safeBackendMessage(payload, "Sign-in could not be completed.") },
      { status: upstream.status, headers: { "cache-control": "no-store" } },
    );
  }
  const { sessionToken, expiresInSeconds, ...safePayload } = payload ?? {};
  const response = NextResponse.json(safePayload, { headers: { "cache-control": "no-store" } });
  if ((action === "confirm" || action === "verify")
    && typeof sessionToken === "string" && typeof expiresInSeconds === "number") {
    response.cookies.set(OPERATOR_COOKIE, sessionToken, operatorCookieOptions(expiresInSeconds));
  }
  return response;
}
