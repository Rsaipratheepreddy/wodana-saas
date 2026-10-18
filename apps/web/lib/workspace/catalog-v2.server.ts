import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import type { CatalogSummary } from "./catalog-v2";
import { e2eCatalogResponse } from "./catalog-v2.fixture";

export async function getCatalogsPageData(): Promise<{ workspaceId: string; catalogs: CatalogSummary[]; canManage: boolean; canReview: boolean; currency: string; locale?: string; error?: string }> {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (membership?.workspaceId && process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    return { workspaceId: membership.workspaceId, catalogs: e2eCatalogResponse("GET", [], undefined, new URLSearchParams()) as CatalogSummary[], canManage: true, canReview: true, currency: "AED", locale: "en-AE" };
  }
  if (!membership?.workspaceId || !token) redirect("/login");
  const canManage = Boolean(membership.allowedPermissions?.includes("catalog.manage"));
  const canReview = Boolean(membership.allowedPermissions?.includes("commercial.estimate"));
  const workspace = await fetch(businessApiUrl(`/workspaces/${membership.workspaceId}`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { workspace?: { defaultCurrency?: string; defaultLocale?: string } } | null;
  const currency = workspace?.workspace?.defaultCurrency ?? "USD";
  const locale = workspace?.workspace?.defaultLocale;
  const response = await fetch(businessApiUrl(`/workspaces/${membership.workspaceId}/catalogs`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (response?.status === 401) redirect("/login");
  if (!response?.ok) return { workspaceId: membership.workspaceId, catalogs: [], canManage: false, canReview: false, currency, locale, error: response?.status === 403 ? "You need catalog access. Ask a workspace admin." : "The catalog could not be loaded." };
  return { workspaceId: membership.workspaceId, catalogs: await response.json(), canManage, canReview, currency, locale };
}
