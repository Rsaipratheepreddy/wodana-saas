import "server-only";

import { businessApiUrl } from "@/lib/auth/server";
import { isSameOrigin } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Forwards a public booking request to the service. Writes must come from the booking page itself. */
export async function forwardPublic(request: Request, path: string, init: { method: "GET" | "POST"; write?: boolean } = { method: "GET" }) {
  const t = await getServerT();
  if (init.write && !isSameOrigin(request)) return Response.json({ message: t("Please book from the booking page.") }, { status: 403 });
  let body: string | undefined;
  if (init.method === "POST") {
    body = await request.text();
    if (body.length > 30_000) return Response.json({ message: t("Your answers are too long.") }, { status: 413 });
    try { JSON.parse(body || "{}"); } catch { return Response.json({ message: t("Please try again.") }, { status: 400 }); }
  }
  try {
    const forwarded = request.headers.get("x-forwarded-for");
    const response = await fetch(businessApiUrl(`/public/booking/${path}`), {
      method: init.method, cache: "no-store", signal: AbortSignal.timeout(20_000),
      headers: { "content-type": "application/json", ...(forwarded ? { "x-forwarded-for": forwarded } : {}) }, body,
    });
    const result = await response.json().catch(() => ({}));
    return Response.json(response.status >= 500 ? { message: t("Booking is unavailable right now. Please try again.") } : result, { status: response.status, headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ message: t("Booking is unavailable right now. Please try again.") }, { status: 503 }); }
}
