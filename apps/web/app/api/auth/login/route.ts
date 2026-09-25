import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { resolveTenantHost } from "@/lib/auth/resolve-tenant-host";
import {
  ACCESS_COOKIE,
  ACTIVE_WORKSPACE_COOKIE,
  MFA_CHALLENGE_COOKIE,
  MFA_REVOKE_COOKIE,
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
  mfa?: {
    enrollmentRequired?: boolean;
    enrollmentDeadline?: string | null;
  };
};

type LoginChallengeResponse = {
  mfaRequired: true;
  challengeToken: string;
  challengeExpiresIn: number;
  methods: string[];
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  let resolvedHost: Awaited<ReturnType<typeof resolveTenantHost>>;
  try { resolvedHost = await resolveTenantHost(request.headers.get("host") ?? new URL(request.url).host); }
  catch { return NextResponse.json({ message: "The sign-in service is temporarily unavailable." }, { status: 503 }); }
  if (!resolvedHost) return NextResponse.json({ message: "This login address is not active." }, { status: 404 });
  const requestedSlug = typeof body?.tenantSlug === "string" ? body.tenantSlug : "";
  if (requestedSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug)) {
    return NextResponse.json({ message: "Choose a valid organization." }, { status: 400 });
  }
  const tenantSlug = resolvedHost.kind === "tenant" ? resolvedHost.branding.loginSlug
    : requestedSlug || process.env.LOGIN_TENANT_SLUG || "";
  if (resolvedHost.kind === "tenant" && requestedSlug && requestedSlug !== tenantSlug) {
    return NextResponse.json({ message: "This organization does not match the login address." }, { status: 400 });
  }
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

  if (payload?.workspaceSelectionRequired === true && Array.isArray(payload.workspaces)) {
    // Email-first sign-in: no session exists yet; the browser resubmits with the chosen slug.
    return NextResponse.json({
      workspaceSelectionRequired: true,
      workspaces: payload.workspaces.map((workspace: Record<string, unknown>) => ({
        name: String(workspace.name ?? ""),
        loginSlug: String(workspace.loginSlug ?? ""),
        logoUrl: typeof workspace.logoUrl === "string" ? workspace.logoUrl : null,
      })),
    });
  }

  if (payload?.mfaRequired === true) {
    if (typeof payload.challengeToken !== "string" || !payload.challengeToken
      || !Number.isFinite(payload.challengeExpiresIn) || payload.challengeExpiresIn <= 0
      || !Array.isArray(payload.methods)) {
      return NextResponse.json({ message: "The sign-in service returned an incomplete MFA challenge. Please try again." }, { status: 502 });
    }
    const challenge = payload as LoginChallengeResponse;
    const response = NextResponse.json({
      mfaRequired: true,
      challengeExpiresIn: challenge.challengeExpiresIn,
      methods: challenge.methods,
    });
    response.cookies.set(MFA_CHALLENGE_COOKIE, challenge.challengeToken, {
      ...authCookieOptions,
      maxAge: challenge.challengeExpiresIn,
    });
    response.cookies.set(TENANT_COOKIE, tenantSlug, {
      ...authCookieOptions,
      maxAge: challenge.challengeExpiresIn,
    });
    const revokeFamilyId = typeof body?.revokeFamilyId === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.revokeFamilyId)
      ? body.revokeFamilyId
      : null;
    if (revokeFamilyId) {
      response.cookies.set(MFA_REVOKE_COOKIE, revokeFamilyId, {
        ...authCookieOptions,
        maxAge: challenge.challengeExpiresIn,
      });
    } else response.cookies.delete(MFA_REVOKE_COOKIE);
    response.headers.set("cache-control", "no-store");
    return response;
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
    mfaEnrollmentRequired: session.mfa?.enrollmentRequired === true,
    mfaEnrollmentDeadline: session.mfa?.enrollmentDeadline ?? null,
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
  response.cookies.set(ACTIVE_WORKSPACE_COOKIE, session.selectedWorkspaceId, {
    ...authCookieOptions,
    maxAge: session.refreshTokenExpiresIn,
  });
  response.cookies.delete(MFA_CHALLENGE_COOKIE);
  response.cookies.delete(MFA_REVOKE_COOKIE);
  response.headers.set("cache-control", "no-store");
  return response;
}
