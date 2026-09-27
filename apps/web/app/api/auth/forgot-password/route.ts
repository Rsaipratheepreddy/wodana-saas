import { NextResponse } from "next/server";
import { resolveTenantHost } from "@/lib/auth/resolve-tenant-host";
import { businessApiUrl, safeBackendMessage } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";

export async function POST(request: Request) {
  const t = await getServerT();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  let resolvedHost: Awaited<ReturnType<typeof resolveTenantHost>>;
  try { resolvedHost = await resolveTenantHost(request.headers.get("host") ?? new URL(request.url).host); }
  catch { return NextResponse.json({ message: t("The sign-in service is temporarily unavailable.") }, { status: 503 }); }
  if (!resolvedHost) return NextResponse.json({ message: t("This login address is not active.") }, { status: 404 });
  const requestedSlug = typeof body?.tenantSlug === "string" ? body.tenantSlug : "";
  if (requestedSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug)) {
    return NextResponse.json({ message: t("Choose a valid organization.") }, { status: 400 });
  }
  const tenantSlug = resolvedHost.kind === "tenant" ? resolvedHost.branding.loginSlug
    : requestedSlug || process.env.LOGIN_TENANT_SLUG || "iglo-architects";
  if (resolvedHost.kind === "tenant" && requestedSlug && requestedSlug !== tenantSlug) {
    return NextResponse.json({ message: t("This organization does not match the login address.") }, { status: 400 });
  }
  const upstream = await fetch(businessApiUrl("/auth/password/forgot"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: body?.email,
      tenantSlug,
    }),
    cache: "no-store",
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: t("Authentication service is unavailable.") }, { status: 503 });
  const payload = await upstream.json().catch(() => null);
  return NextResponse.json(
    upstream.ok ? payload : { message: safeBackendMessage(payload, t("Unable to start recovery.")) },
    { status: upstream.status },
  );
}
