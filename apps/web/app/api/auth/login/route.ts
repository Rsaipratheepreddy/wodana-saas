import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  TENANT_COOKIE,
  authCookieOptions,
  businessApiUrl,
  safeBackendMessage,
} from "@/lib/auth/server";

type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
  selectedWorkspaceId: string;
  profile: { nextAction: string };
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const tenantSlug = String(body?.tenantSlug ?? process.env.LOGIN_TENANT_SLUG ?? "iglo-architects");
  const upstream = await fetch(businessApiUrl("/auth/login"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": request.headers.get("user-agent") ?? "Wodana Web",
      ...(request.headers.get("x-forwarded-for")
        ? { "x-forwarded-for": request.headers.get("x-forwarded-for")! }
        : {}),
    },
    body: JSON.stringify({ email: body?.email, password: body?.password, revokeFamilyId: body?.revokeFamilyId, tenantSlug, currentRefreshToken: (await cookies()).get(REFRESH_COOKIE)?.value }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json({ message: "Authentication service is unavailable." }, { status: 503 });
  }
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return NextResponse.json(
      { message: safeBackendMessage(payload, "Unable to sign in."),
        ...(upstream.status === 409 && payload?.code === "DEVICE_LIMIT_REACHED"
          ? { code: payload.code, sessions: payload.sessions, maxActiveDevices: payload.maxActiveDevices } : {}),
      },
      { status: upstream.status },
    );
  }

  if (!payload || typeof payload.accessToken !== "string" || !payload.accessToken
    || typeof payload.refreshToken !== "string" || !payload.refreshToken
    || !Number.isFinite(payload.accessTokenExpiresIn) || payload.accessTokenExpiresIn <= 0
    || !Number.isFinite(payload.refreshTokenExpiresIn) || payload.refreshTokenExpiresIn <= 0
    || typeof payload.profile?.nextAction !== "string") {
    return NextResponse.json({ message: "The sign-in service returned an incomplete session. Please try again." }, { status: 502 });
  }
  const session = payload as LoginResponse;
  const response = NextResponse.json({
    authenticated: true,
    nextAction: session.profile.nextAction,
    selectedWorkspaceId: session.selectedWorkspaceId,
  });
  response.cookies.set(ACCESS_COOKIE, session.accessToken, {
    ...authCookieOptions,
    maxAge: session.accessTokenExpiresIn,
  });
  response.cookies.set(REFRESH_COOKIE, session.refreshToken, {
    ...authCookieOptions,
    maxAge: session.refreshTokenExpiresIn,
  });
  response.cookies.set(TENANT_COOKIE, tenantSlug, {
    ...authCookieOptions,
    maxAge: session.refreshTokenExpiresIn,
  });
  response.headers.set("cache-control", "no-store");
  return response;
}
