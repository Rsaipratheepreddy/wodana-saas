import { NextResponse } from "next/server";
import { businessApiUrl, safeBackendMessage } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";
import { isSameOrigin } from "@/lib/workspace/workspace-api";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The signing page's API (R8): no account, the link's token is the key. The signer's address and browser are passed
 * on as evidence for the certificate page; the document streams through unchanged so its SHA-256 holds.
 */
async function handle(request: Request, { params }: { params: Promise<{ token: string; action?: string[] }> }) {
  const t = await getServerT();
  const { token, action = [] } = await params;
  const step = action.join("/");
  const read = request.method === "GET" && (step === "" || step === "document");
  const write = request.method === "POST" && (step === "sign" || step === "code" || step === "code/verify");
  if (!TOKEN.test(token) || (!read && !write)) return NextResponse.json({ message: t("This signing link isn't valid.") }, { status: 404 });
  if (write && !isSameOrigin(request)) return NextResponse.json({ message: t("Open the signing link to continue.") }, { status: 403 });
  const copy = new URL(request.url).searchParams.get("copy") === "signed" ? "?copy=signed" : "";
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  const body = write ? await request.text() : undefined;
  if (body && body.length > 400_000) return NextResponse.json({ message: t("The signature is too large. Draw it again.") }, { status: 413 });
  const upstream = await fetch(businessApiUrl(`/esign/${token}${step ? `/${step}` : ""}${step === "document" ? copy : ""}`), {
    method: request.method, cache: "no-store", body,
    headers: { "content-type": "application/json", ...(address ? { "x-signer-ip": address.slice(0, 64) } : {}), "x-signer-agent": (request.headers.get("user-agent") ?? "").slice(0, 500) },
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: t("Signing is taking a break. Please try again in a moment.") }, { status: 503 });
  if (step === "document" && upstream.ok) {
    return new NextResponse(upstream.body, { status: 200, headers: {
      "content-type": "application/pdf", "content-disposition": upstream.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    } });
  }
  const data = await upstream.json().catch(() => null);
  const response = NextResponse.json(upstream.ok ? data : { message: safeBackendMessage(data, t("That didn't work. Please try again.")) }, { status: upstream.status });
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export { handle as GET, handle as POST };
