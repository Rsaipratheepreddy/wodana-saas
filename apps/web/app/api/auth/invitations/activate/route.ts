import { NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  authCookieOptions,
  businessApiUrl,
  safeBackendMessage,
} from "@/lib/auth/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const upstream = await fetch(businessApiUrl("/auth/invitations/activate"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: "Authentication service is unavailable." }, { status: 503 });
  const payload = await upstream.json().catch(() => null) as Record<string, unknown> | null;
  if (!upstream.ok) {
    return NextResponse.json(
      { message: safeBackendMessage(payload, "Unable to activate invitation.") },
      { status: upstream.status },
    );
  }
  if (typeof payload?.accessToken !== "string" || !payload.accessToken
    || typeof payload.refreshToken !== "string" || !payload.refreshToken
    || !Number.isFinite(payload.accessTokenExpiresIn) || Number(payload.accessTokenExpiresIn) <= 0
    || !Number.isFinite(payload.refreshTokenExpiresIn) || Number(payload.refreshTokenExpiresIn) <= 0
    || typeof payload.selectedWorkspaceId !== "string") {
    return NextResponse.json(
      { message: "The activation service returned an incomplete session. Sign in again." },
      { status: 502 },
    );
  }
  const mfa = payload.mfa && typeof payload.mfa === "object"
    ? payload.mfa as Record<string, unknown>
    : null;
  const response = NextResponse.json({
    authenticated: true,
    nextAction: "start_onboarding",
    selectedWorkspaceId: payload.selectedWorkspaceId,
    mfaEnrollmentRequired: mfa?.enrollmentRequired === true,
    mfaEnrollmentDeadline: typeof mfa?.enrollmentDeadline === "string"
      ? mfa.enrollmentDeadline
      : null,
  });
  response.cookies.set(ACCESS_COOKIE, String(payload?.accessToken), {
    ...authCookieOptions,
    maxAge: Number(payload.accessTokenExpiresIn),
  });
  response.cookies.set(REFRESH_COOKIE, String(payload?.refreshToken), {
    ...authCookieOptions,
    maxAge: Number(payload.refreshTokenExpiresIn),
  });
  return response;
}
