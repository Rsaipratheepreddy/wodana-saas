import { NextResponse } from "next/server";
import { businessApiUrl, safeBackendMessage } from "@/lib/auth/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const upstream = await fetch(businessApiUrl("/auth/password/reset"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: "Authentication service is unavailable." }, { status: 503 });
  const payload = await upstream.json().catch(() => null);
  return NextResponse.json(
    upstream.ok ? payload : { message: safeBackendMessage(payload, "Unable to reset password.") },
    { status: upstream.status },
  );
}
