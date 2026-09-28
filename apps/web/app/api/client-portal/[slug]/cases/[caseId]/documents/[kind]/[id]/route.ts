import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { businessApiUrl, safeBackendMessage } from "@/lib/auth/server";
import { PORTAL_SLUG, portalCookie } from "@/lib/client-portal/server";
import { getServerT } from "@/lib/i18n/server";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORD = /^[A-Za-z0-9_-]{1,80}$/;

/** A tax invoice or receipt of the signed-in client's, to print. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; caseId: string; kind: string; id: string }> }) {
  const t = await getServerT();
  const { slug, caseId, kind, id } = await params;
  if (!PORTAL_SLUG.test(slug) || !ID.test(caseId) || !["invoice", "receipt"].includes(kind) || !RECORD.test(id))
    return NextResponse.json({ message: t("This isn't a portal request.") }, { status: 400 });
  const token = (await cookies()).get(portalCookie(slug))?.value;
  if (!token) return NextResponse.json({ message: t("Sign in again to continue.") }, { status: 401 });
  const upstream = await fetch(businessApiUrl(`/client-portal/${slug}/cases/${caseId}/documents/${kind}/${id}`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
    .catch(() => null);
  if (!upstream) return NextResponse.json({ message: t("Your project page is taking a break. Please try again in a moment.") }, { status: 503 });
  const data = await upstream.json().catch(() => null) as Record<string, unknown> | null;
  const response = NextResponse.json(upstream.ok ? data : { message: safeBackendMessage(data, t("That didn't work. Please try again.")) }, { status: upstream.status });
  response.headers.set("cache-control", "private, no-store");
  return response;
}
