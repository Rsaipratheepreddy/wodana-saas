import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  applyRotatedSession,
  authenticatedBackendPost,
} from "@/lib/auth/backend-session";
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
import { isSameOrigin, UUID } from "@/lib/workspace/workspace-api";

const protectedActions = {
  setup: { path: "/security/mfa/totp/setup", needsCode: false },
  confirm: { path: "/security/mfa/totp/confirm", needsCode: true },
  "step-up": { path: "/security/mfa/step-up", needsCode: true },
  recovery: { path: "/security/mfa/recovery-codes/regenerate", needsCode: false },
  disable: { path: "/security/mfa/disable", needsCode: false },
} as const;

type SessionPayload = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
  selectedWorkspaceId: string;
  profile?: { nextAction?: string };
  mfa?: { enrollmentRequired?: boolean; enrollmentDeadline?: string | null };
};

function validSession(payload: unknown): payload is SessionPayload {
  if (!payload || typeof payload !== "object") return false;
  const session = payload as Partial<SessionPayload>;
  return typeof session.accessToken === "string" && Boolean(session.accessToken)
    && typeof session.refreshToken === "string" && Boolean(session.refreshToken)
    && Number.isFinite(session.accessTokenExpiresIn) && Number(session.accessTokenExpiresIn) > 0
    && Number.isFinite(session.refreshTokenExpiresIn) && Number(session.refreshTokenExpiresIn) > 0
    && typeof session.selectedWorkspaceId === "string";
}

async function verifyChallenge(code: string) {
  const cookieStore = await cookies();
  const challengeToken = cookieStore.get(MFA_CHALLENGE_COOKIE)?.value;
  if (!challengeToken) {
    return NextResponse.json(
      { message: "This verification request expired. Sign in again." },
      { status: 410 },
    );
  }
  const upstream = await fetch(businessApiUrl("/auth/mfa/verify"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challengeToken,
      code,
      currentRefreshToken: cookieStore.get(REFRESH_COOKIE)?.value,
      revokeFamilyId: cookieStore.get(MFA_REVOKE_COOKIE)?.value,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!upstream) {
    return NextResponse.json({ message: "Authentication service is unavailable." }, { status: 503 });
  }
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const deviceLimit = upstream.status === 409 && payload?.code === "DEVICE_LIMIT_REACHED";
    const response = NextResponse.json(
      {
        message: safeBackendMessage(payload, "The verification code could not be accepted."),
        ...(deviceLimit ? {
          code: payload.code,
          sessions: payload.sessions,
          maxActiveDevices: payload.maxActiveDevices,
        } : {}),
      },
      { status: upstream.status },
    );
    if ([409, 410, 429].includes(upstream.status)) {
      response.cookies.delete(MFA_CHALLENGE_COOKIE);
      response.cookies.delete(MFA_REVOKE_COOKIE);
    }
    return response;
  }
  if (!validSession(payload)) {
    return NextResponse.json(
      { message: "The sign-in service returned an incomplete session. Sign in again." },
      { status: 502 },
    );
  }
  const response = NextResponse.json({
    authenticated: true,
    nextAction: payload.profile?.nextAction ?? "enter_workspace",
    selectedWorkspaceId: payload.selectedWorkspaceId,
    mfaEnrollmentRequired: payload.mfa?.enrollmentRequired === true,
    mfaEnrollmentDeadline: payload.mfa?.enrollmentDeadline ?? null,
  });
  response.cookies.set(ACCESS_COOKIE, payload.accessToken, {
    ...authCookieOptions,
    maxAge: payload.accessTokenExpiresIn,
  });
  response.cookies.set(REFRESH_COOKIE, payload.refreshToken, {
    ...authCookieOptions,
    maxAge: payload.refreshTokenExpiresIn,
  });
  response.cookies.set(ACTIVE_WORKSPACE_COOKIE, payload.selectedWorkspaceId, {
    ...authCookieOptions,
    maxAge: payload.refreshTokenExpiresIn,
  });
  const tenantSlug = cookieStore.get(TENANT_COOKIE)?.value;
  if (tenantSlug) {
    response.cookies.set(TENANT_COOKIE, tenantSlug, {
      ...authCookieOptions,
      maxAge: payload.refreshTokenExpiresIn,
    });
  }
  response.cookies.delete(MFA_CHALLENGE_COOKIE);
  response.cookies.delete(MFA_REVOKE_COOKIE);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function protectedMfaAction(
  action: keyof typeof protectedActions,
  body: Record<string, unknown>,
) {
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId)) {
    return NextResponse.json({ message: "A valid workspace is required." }, { status: 400 });
  }
  const definition = protectedActions[action];
  const result = await authenticatedBackendPost(definition.path, {
    workspaceId,
    ...(definition.needsCode ? { code: body.code } : {}),
  });
  if (result.unauthenticated) {
    const response = NextResponse.json(
      { message: "Your session has expired. Sign in again." },
      { status: 401 },
    );
    applyRotatedSession(response, result.rotatedSession);
    return response;
  }
  if (!result.upstream) {
    return NextResponse.json({ message: "The security service is unavailable." }, { status: 503 });
  }
  const payload = await result.upstream.json().catch(() => null);
  const response = NextResponse.json(
    result.upstream.ok
      ? payload
      : { message: safeBackendMessage(payload, "The MFA request could not be completed.") },
    { status: result.upstream.status },
  );
  applyRotatedSession(response, result.rotatedSession);
  if (result.upstream.ok && payload && typeof payload.accessToken === "string"
    && Number.isFinite(payload.accessTokenExpiresIn)) {
    response.cookies.set(ACCESS_COOKIE, payload.accessToken, {
      ...authCookieOptions,
      maxAge: payload.accessTokenExpiresIn,
    });
  }
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ message: "Use the Wodana sign-in screen to continue." }, { status: 403 });
  }
  const action = (await params).action;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ message: "A valid MFA request is required." }, { status: 400 });
  if (action === "verify") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (code.length < 6 || code.length > 32) {
      return NextResponse.json({ message: "Enter a valid authenticator or recovery code." }, { status: 400 });
    }
    return verifyChallenge(code);
  }
  if (!(action in protectedActions)) {
    return NextResponse.json({ message: "Unknown MFA action." }, { status: 404 });
  }
  const protectedAction = action as keyof typeof protectedActions;
  if (protectedActions[protectedAction].needsCode) {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (code.length < 6 || code.length > 32) {
      return NextResponse.json({ message: "Enter a valid authenticator or recovery code." }, { status: 400 });
    }
    body.code = code;
  }
  return protectedMfaAction(protectedAction, body);
}
