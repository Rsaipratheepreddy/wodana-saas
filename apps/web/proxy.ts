import { NextRequest, NextResponse } from "next/server";
import { forwardedDeviceHeaders } from "@/lib/auth/device-request";
import { deferredModuleForPath, isCrmFirstWorkspace, moduleForWorkspacePath } from "@/lib/workspace/module-rollout";

const ACCESS_COOKIE = "wodana_access";
const REFRESH_COOKIE = "wodana_refresh";
type BootstrapProfile = {
  nextAction?: unknown;
  memberships?: Array<{ workspaceId: string; workspaceSlug: string; allowedModules?: string[]; roles?: string[]; onboarding?: { status?: string } }>;
};

const ALL_WORKSPACE_MODULES = ["workspace", "crm", "pre-project", "projects", "hrms"] as const;

function needsOnboarding(profile: BootstrapProfile | null, membership?: { onboarding?: { status?: string } }) {
  if (membership?.onboarding) return membership.onboarding.status !== "completed";
  return profile?.nextAction === "start_onboarding" || profile?.nextAction === "resume_onboarding";
}

function onboardingRedirect(request: NextRequest) {
  return NextResponse.redirect(new URL("/onboarding", request.url));
}

function workspaceRedirect(profile: BootstrapProfile | null, request: NextRequest, refreshed = false) {
  const selectedId = request.cookies.get("wodana_workspace")?.value;
  const membership = profile?.memberships?.find((item) => item.workspaceId === selectedId) ?? profile?.memberships?.[0];
  if (needsOnboarding(profile, membership)) return onboardingRedirect(request);
  const deferred = deferredModuleForPath(request.nextUrl.pathname);
  const ownerAccess = membership?.roles?.some((role) => role === "owner" || role === "administrator") ?? false;
  // Legacy business-core releases do not include module grants in /me. Keep
  // their established access working until an explicit entitlement list exists.
  const allowedModules = ownerAccess ? ALL_WORKSPACE_MODULES : membership?.allowedModules ?? ALL_WORKSPACE_MODULES;
  if (!membership || !allowedModules.includes(moduleForWorkspacePath(request.nextUrl.pathname))) {
    return NextResponse.redirect(new URL("/workspace-access-denied", request.url));
  }
  if (deferred && membership && isCrmFirstWorkspace(membership.workspaceSlug)) {
    const destination = new URL("/workspace/coming-soon", request.url);
    destination.searchParams.set("module", deferred);
    return NextResponse.redirect(destination);
  }
  return refreshed ? NextResponse.next({ request: { headers: request.headers } }) : NextResponse.next();
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
      return workspaceRedirect(profile, request);
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
      const response = workspaceRedirect(profile, request, true);
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
