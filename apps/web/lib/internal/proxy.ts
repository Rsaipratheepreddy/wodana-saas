import "server-only";

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { businessApiUrl, safeBackendMessage } from "@/lib/auth/server";
import { getOperatorSession } from "./auth";

export async function internalJsonResponse(
  path: string,
  init: RequestInit,
  fallback: string,
) {
  const session = await getOperatorSession();
  if (!session) return NextResponse.json({ message: "Your operator session has ended. Sign in again." }, { status: 401 });
  const token = process.env.BUSINESS_CORE_INTERNAL_TOKEN;
  if (!token) return NextResponse.json({ message: "Internal client management is not configured." }, { status: 503 });
  const upstream = await fetch(businessApiUrl(path), {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init.headers)),
      "x-wodana-internal-token": token,
      "x-wodana-operator-session": session.token,
      "x-request-id": randomUUID(),
    },
    cache: "no-store",
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: "The client management service is unavailable." }, { status: 503 });
  const payload = await upstream.json().catch(() => null);
  const response = NextResponse.json(
    upstream.ok ? payload : { message: safeBackendMessage(payload, fallback) },
    { status: upstream.status },
  );
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function internalBinaryResponse(path: string, fallback: string) {
  const session = await getOperatorSession();
  if (!session) return NextResponse.json({ message: "Your operator session has ended. Sign in again." }, { status: 401 });
  const token = process.env.BUSINESS_CORE_INTERNAL_TOKEN;
  if (!token) return NextResponse.json({ message: "Internal client management is not configured." }, { status: 503 });
  const upstream = await fetch(businessApiUrl(path), {
    headers: {
      "x-wodana-internal-token": token,
      "x-wodana-operator-session": session.token,
      "x-request-id": randomUUID(),
    },
    cache: "no-store",
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: "The client management service is unavailable." }, { status: 503 });
  if (!upstream.ok) {
    const payload = await upstream.json().catch(() => null);
    return NextResponse.json({ message: safeBackendMessage(payload, fallback) }, { status: upstream.status });
  }
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": upstream.headers.get("content-disposition") ?? "attachment",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      ...(upstream.headers.get("content-length") ? { "content-length": upstream.headers.get("content-length")! } : {}),
    },
  });
}
