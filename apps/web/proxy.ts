import { NextRequest, NextResponse } from "next/server";
import { forwardedDeviceHeaders } from "@/lib/auth/device-request";

const ACCESS_COOKIE = "wodana_access";
const REFRESH_COOKIE = "wodana_refresh";
type BootstrapProfile = { nextAction?: unknown };

function needsOnboarding(profile: BootstrapProfile | null) {
  return profile?.nextAction === "start_onboarding" || profile?.nextAction === "resume_onboarding";
}

function onboardingRedirect(request: NextRequest) {
  return NextResponse.redirect(new URL("/onboarding", request.url));
}

function signInRedirect(request: NextRequest, unavailable = false) {
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  login.searchParams.set("reason", unavailable ? "session-unavailable" : "session-ended");
  const tenant = request.cookies.get("wodana_tenant")?.value;
  if (tenant) login.searchParams.set("tenant", tenant);
  const response = NextResponse.redirect(login);
  if (!unavailable) {
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
  }
  return response;
}

function apiUrl(path: string) {
  const base = process.env.BUSINESS_CORE_URL
    ?? process.env.NEXT_PUBLIC_BUSINESS_API_URL
    ?? "http://127.0.0.1:8000/api/v1";
  return `${base.replace(/\/$/, "")}${path}`;
}

export async function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    return NextResponse.next();
  }
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (accessToken) {
    const current = await fetch(apiUrl("/me"), {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    }).catch(() => null);
    if (current?.ok) {
      const profile = await current.json().catch(() => null) as BootstrapProfile | null;
      return needsOnboarding(profile) ? onboardingRedirect(request) : NextResponse.next();
    }
    if (!current || current.status >= 500) return signInRedirect(request, true);
  }

  if (refreshToken) {
    const refreshed = await fetch(apiUrl("/auth/refresh"), {
      method: "POST",
      headers: { "content-type": "application/json", ...forwardedDeviceHeaders(request.headers) },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    }).catch(() => null);
    if (!refreshed || refreshed.status >= 500) return signInRedirect(request, true);
    if (refreshed.ok) {
      const session = await refreshed.json() as {
        accessToken: string;
        refreshToken: string;
        accessTokenExpiresIn: number;
        refreshTokenExpiresIn: number;
      };
      request.cookies.set(ACCESS_COOKIE, session.accessToken);
      request.cookies.set(REFRESH_COOKIE, session.refreshToken);
      const current = await fetch(apiUrl("/me"), {
        headers: { authorization: `Bearer ${session.accessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      }).catch(() => null);
      if (!current || current.status >= 500) return signInRedirect(request, true);
      if (!current.ok) return signInRedirect(request);
      const profile = await current.json().catch(() => null) as BootstrapProfile | null;
      const response = needsOnboarding(profile)
        ? onboardingRedirect(request)
        : NextResponse.next({ request: { headers: request.headers } });
      const options = {
        httpOnly: true,
        sameSite: "strict" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        priority: "high" as const,
      };
      response.cookies.set(ACCESS_COOKIE, session.accessToken, {
        ...options,
        maxAge: session.accessTokenExpiresIn,
      });
      response.cookies.set(REFRESH_COOKIE, session.refreshToken, {
        ...options,
        maxAge: session.refreshTokenExpiresIn,
      });
      return response;
    }
  }

  return signInRedirect(request);
}

export const config = { matcher: ["/workspace/:path*"] };
