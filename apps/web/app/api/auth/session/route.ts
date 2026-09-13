import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, businessApiUrl } from "@/lib/auth/server";

export async function GET() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ authenticated: false }, { status: cookieStore.has(REFRESH_COOKIE) ? 409 : 401 });
  }
  const upstream = await fetch(businessApiUrl("/me"), {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!upstream || upstream.status >= 500) {
    return NextResponse.json({ message: "Authentication service is unavailable." }, { status: 503 });
  }
  if (upstream.status === 401) {
    // JWT decoding here only decides whether to ask the page proxy to refresh.
    // The backend remains the authority for authentication and session revocation.
    let expiresAt = 0;
    try { expiresAt = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString()).exp * 1000; } catch { /* malformed token */ }
    if (expiresAt && expiresAt <= Date.now() && cookieStore.has(REFRESH_COOKIE)) {
      return NextResponse.json({ authenticated: false }, { status: 409 });
    }
    const response = NextResponse.json({ authenticated: false }, { status: 401 });
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
    response.headers.set("cache-control", "no-store");
    return response;
  }
  if (!upstream.ok) return NextResponse.json({ message: "Session could not be checked." }, { status: upstream.status });
  return NextResponse.json({ authenticated: true, profile: await upstream.json() }, { headers: { "cache-control": "no-store" } });
}
