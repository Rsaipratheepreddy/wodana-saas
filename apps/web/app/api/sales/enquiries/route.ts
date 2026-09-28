import { businessApiUrl, safeBackendMessage } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";
import { isSameOrigin } from "@/lib/workspace/workspace-api";

/**
 * Wodana's public "Contact sales" form. Same-origin only; the visitor's address is passed on (with the
 * internal service token that makes business-core trust it) so each connection is limited.
 */
export async function POST(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return Response.json({ message: t("Please send the form from our website.") }, { status: 403 });
  const body = await request.text();
  if (body.length > 20_000) return Response.json({ message: t("Your message is too long.") }, { status: 413 });
  try { JSON.parse(body); } catch { return Response.json({ message: t("Your enquiry could not be sent. Please try again.") }, { status: 400 }); }
  const requester = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  const token = process.env.BUSINESS_CORE_INTERNAL_TOKEN;
  const upstream = await fetch(businessApiUrl("/public/sales/enquiries"), {
    method: "POST",
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "content-type": "application/json",
      ...(requester ? { "x-sales-requester": requester.slice(0, 100) } : {}),
      ...(token ? { "x-wodana-internal-token": token } : {}),
    },
  }).catch(() => null);
  if (!upstream) return Response.json({ message: t("Your enquiry could not be sent. Please try again.") }, { status: 503 });
  const payload = await upstream.json().catch(() => null) as Record<string, unknown> | null;
  if (upstream.ok) {
    return Response.json({ received: true, thankYouTitle: payload?.thankYouTitle ?? null, thankYouMessage: payload?.thankYouMessage ?? null },
      { status: 201, headers: { "cache-control": "no-store" } });
  }
  const message = upstream.status >= 500 ? t("Your enquiry could not be sent. Please try again.")
    : safeBackendMessage(payload, t("Your enquiry could not be sent. Please try again."));
  return Response.json({ message, ...(typeof payload?.retryAfter === "number" ? { retryAfter: payload.retryAfter } : {}) },
    { status: upstream.status, headers: { "cache-control": "no-store" } });
}
