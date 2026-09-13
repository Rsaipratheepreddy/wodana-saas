import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { businessApiUrl, safeBackendMessage } from "@/lib/auth/server";
import { isSameOrigin } from "@/lib/workspace/workspace-api";
async function handle(
  request: Request,
  { params }: { params: Promise<{ slug: string; action: string }> },
) {
  const { slug, action } = await params;
  if (
    !/^[a-z0-9-]{1,80}$/.test(slug) ||
    !["brand", "challenge", "login", "data", "action", "logout"].includes(
      action,
    ) ||
    (["brand", "data"].includes(action)
      ? request.method !== "GET"
      : request.method !== "POST")
  )
    return NextResponse.json(
      { message: "Invalid portal request." },
      { status: 400 },
    );
  if (request.method === "POST" && !isSameOrigin(request))
    return NextResponse.json(
      { message: "Use the client portal to continue." },
      { status: 403 },
    );
  const name = `wodana_client_${slug}`,
    token = (await cookies()).get(name)?.value ?? "";
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 20000)
    return NextResponse.json(
      { message: "This message is too long." },
      { status: 413 },
    );
  const upstream = await fetch(
    businessApiUrl(`/client-portal/${slug}/${action}`),
    {
      method: request.method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body,
      cache: "no-store",
    },
  ).catch(() => null);
  if (!upstream)
    return NextResponse.json(
      { message: "The portal is temporarily unavailable. Please try again." },
      { status: 503 },
    );
  const data = await upstream.json().catch(() => null);
  const response = NextResponse.json(
    upstream.ok
      ? action === "login"
        ? { ok: true }
        : data
      : {
          message: safeBackendMessage(data, "Could not complete this action."),
        },
    { status: upstream.status },
  );
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: action === "logout" ? 0 : (data?.expiresIn ?? 28800),
  };
  if (upstream.ok && action === "login")
    response.cookies.set(name, data.token, options);
  if (action === "logout" || (upstream.status === 401 && action === "data"))
    response.cookies.set(name, "", { ...options, maxAge: 0 });
  response.headers.set("cache-control", "private, no-store");
  return response;
}
export { handle as GET, handle as POST };
