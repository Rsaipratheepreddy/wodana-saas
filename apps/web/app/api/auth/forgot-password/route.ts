import { NextResponse } from "next/server";
import { businessApiUrl, safeBackendMessage } from "@/lib/auth/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const upstream = await fetch(businessApiUrl("/auth/password/forgot"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: body?.email,
      tenantSlug: body?.tenantSlug ?? process.env.LOGIN_TENANT_SLUG ?? "iglo-architects",
    }),
    cache: "no-store",
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: "Authentication service is unavailable." }, { status: 503 });
  const payload = await upstream.json().catch(() => null);
  return NextResponse.json(
    upstream.ok ? payload : { message: safeBackendMessage(payload, "Unable to start recovery.") },
    { status: upstream.status },
  );
}
