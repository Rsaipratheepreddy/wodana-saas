import "server-only";

import { NextResponse } from "next/server";
import { applyRotatedSession, authenticatedBackendFetch } from "@/lib/auth/backend-session";
import { businessApiUrl, safeBackendMessage, type AuthProfile } from "@/lib/auth/server";

export async function internalJsonResponse(
  path: string,
  init: RequestInit,
  fallback: string,
) {
  const auth = await authenticatedBackendFetch("/me");
  if (auth.unauthenticated || !auth.upstream?.ok) {
    const response = NextResponse.json({ message: "Your session has expired. Sign in again." }, { status: 401 });
    applyRotatedSession(response, auth.rotatedSession);
    return response;
  }
  const profile = await auth.upstream.json() as AuthProfile;
  if (profile.platformRole !== "administrator") {
    const response = NextResponse.json({ message: "Internal portal access is required." }, { status: 403 });
    applyRotatedSession(response, auth.rotatedSession);
    return response;
  }
  const token = process.env.BUSINESS_CORE_INTERNAL_TOKEN;
  if (!token) return NextResponse.json({ message: "Internal client management is not configured." }, { status: 503 });
  const upstream = await fetch(businessApiUrl(path), {
    ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers)), "x-wodana-internal-token": token },
    cache: "no-store",
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: "The client management service is unavailable." }, { status: 503 });
  const payload = await upstream.json().catch(() => null);
  const response = NextResponse.json(
    upstream.ok ? payload : { message: safeBackendMessage(payload, fallback) },
    { status: upstream.status },
  );
  applyRotatedSession(response, auth.rotatedSession);
  response.headers.set("cache-control", "no-store");
  return response;
}
