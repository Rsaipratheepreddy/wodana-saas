import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { businessApiUrl, safeBackendMessage } from "@/lib/auth/server";
import { PORTAL_SLUG, portalCookie } from "@/lib/client-portal/server";
import { getServerT } from "@/lib/i18n/server";
import { isSameOrigin } from "@/lib/workspace/workspace-api";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 20 * 1024 * 1024;

/** A photo or PDF the signed-in client adds to their project (checked by content in the business core). */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; caseId: string; id: string }> }) {
  const t = await getServerT();
  const { slug, caseId, id } = await params;
  if (!PORTAL_SLUG.test(slug) || !ID.test(caseId) || !ID.test(id)) return NextResponse.json({ message: t("This isn't a portal request.") }, { status: 400 });
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Open your project page to continue.") }, { status: 403 });
  const token = (await cookies()).get(portalCookie(slug))?.value;
  if (!token) return NextResponse.json({ message: t("Sign in again to continue.") }, { status: 401 });
  if (Number(request.headers.get("content-length")) > MAX + 1024 * 1024) return NextResponse.json({ message: t("Choose a photo or PDF up to 20 MB.") }, { status: 413 });
  let file: File;
  try {
    const input = await request.formData();
    const value = input.get("file");
    if (!(value instanceof File) || value.size === 0 || value.size > MAX) return NextResponse.json({ message: t("Choose a photo or PDF up to 20 MB.") }, { status: 400 });
    file = value;
  } catch {
    return NextResponse.json({ message: t("Choose a photo or PDF up to 20 MB.") }, { status: 400 });
  }
  const body = new FormData();
  body.set("file", file);
  const upstream = await fetch(businessApiUrl(`/client-portal/${slug}/cases/${caseId}/uploads/${id}`), {
    method: "POST", body, cache: "no-store", headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ message: t("Your project page is taking a break. Please try again in a moment.") }, { status: 503 });
  const data = await upstream.json().catch(() => null) as Record<string, unknown> | null;
  const response = NextResponse.json(upstream.ok ? data : { message: safeBackendMessage(data, t("That file couldn't be added. Try a photo or PDF up to 20 MB.")) }, { status: upstream.status });
  response.headers.set("cache-control", "private, no-store");
  return response;
}
