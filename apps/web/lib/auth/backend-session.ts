import "server-only";

import { cookies, headers } from "next/headers";
import { forwardedDeviceHeaders } from "./device-request";
import type { NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  authCookieOptions,
  businessApiUrl,
} from "./server";

type RotatedSession = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
};

export type AuthenticatedBackendResult = {
  upstream: Response | null;
  rotatedSession?: RotatedSession;
  unauthenticated: boolean;
};

function withBearer(init: RequestInit, token: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return { ...init, headers, cache: "no-store" };
}

export async function authenticatedBackendFetch(
  path: string,
  init: RequestInit = {},
  serviceUrl: (path: string) => string = businessApiUrl,
): Promise<AuthenticatedBackendResult> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  if (!accessToken) return { upstream: null, unauthenticated: true };

  let upstream = await fetch(
    serviceUrl(path),
    withBearer(init, accessToken),
  ).catch(() => null);

  if (upstream?.status !== 401 || !refreshToken) {
    return { upstream, unauthenticated: upstream?.status === 401 };
  }

  const refreshResponse = await fetch(businessApiUrl("/auth/refresh"), {
    method: "POST",
    headers: { "content-type": "application/json", ...forwardedDeviceHeaders(await headers()) },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  }).catch(() => null);

  if (!refreshResponse?.ok) return { upstream: refreshResponse, unauthenticated: true };
  const rotatedSession = await refreshResponse.json() as RotatedSession;
  upstream = await fetch(
    serviceUrl(path),
    withBearer(init, rotatedSession.accessToken),
  ).catch(() => null);

  return {
    upstream,
    rotatedSession,
    unauthenticated: upstream?.status === 401,
  };
}

export function applyRotatedSession(
  response: NextResponse,
  session?: RotatedSession,
): void {
  if (!session) return;
  response.cookies.set(ACCESS_COOKIE, session.accessToken, {
    ...authCookieOptions,
    maxAge: session.accessTokenExpiresIn,
  });
  response.cookies.set(REFRESH_COOKIE, session.refreshToken, {
    ...authCookieOptions,
    maxAge: session.refreshTokenExpiresIn,
  });
}
