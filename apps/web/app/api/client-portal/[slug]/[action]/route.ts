import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { businessApiUrl, safeBackendMessage } from "@/lib/auth/server";
import { PORTAL_SLUG, portalCookie } from "@/lib/client-portal/server";
import { isSameOrigin } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const READS = ["site", "view"];
const WRITES = ["challenge", "login", "command", "logout"];

/**
 * The client portal's API, same-origin only. The session token lives in an http-only cookie per portal and
 * is never readable by the page; the client's address is passed on so code requests are limited per requester.
 */
async function handle(request: Request, { params }: { params: Promise<{ slug: string; action: string }> }) {
  const t = await getServerT();
  const { slug, action } = await params;
  const read = request.method === "GET" && READS.includes(action);
  const write = request.method === "POST" && WRITES.includes(action);
  if (!PORTAL_SLUG.test(slug) || (!read && !write)) return NextResponse.json({ message: t("This isn't a portal request.") }, { status: 400 });
  if (write && !isSameOrigin(request)) return NextResponse.json({ message: t("Open your project page to continue.") }, { status: 403 });
  const name = portalCookie(slug);
  const token = (await cookies()).get(name)?.value ?? "";
  const body = write ? await request.text() : undefined;
  if (body && body.length > 50_000) return NextResponse.json({ message: t("This message is too long.") }, { status: 413 });
  const requester = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  const upstream = await fetch(businessApiUrl(`/client-portal/${slug}/${action}`), {
    method: request.method, cache: "no-store", body,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(requester ? { "x-portal-requester": requester.slice(0, 100) } : {}) },
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: t("Your project page is taking a break. Please try again in a moment.") }, { status: 503 });
  const data = await upstream.json().catch(() => null) as Record<string, unknown> | null;
  const payload = upstream.ok
    ? action === "login" ? { ok: true, needsName: data?.needsName === true } : data
    : { message: safeBackendMessage(data, t("That didn't work. Please try again.")), ...(typeof data?.retryAfter === "number" ? { retryAfter: data.retryAfter } : {}) };
  const response = NextResponse.json(payload, { status: upstream.status });
  const cookie = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/" };
  if (upstream.ok && action === "login" && typeof data?.token === "string")
    response.cookies.set(name, data.token, { ...cookie, maxAge: typeof data.expiresIn === "number" ? data.expiresIn : 90 * 86_400 });
  if (action === "logout" || (upstream.status === 401 && action === "view")) response.cookies.set(name, "", { ...cookie, maxAge: 0 });
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export { handle as GET, handle as POST };
