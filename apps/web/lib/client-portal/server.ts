import "server-only";

import { businessApiUrl } from "@/lib/auth/server";
import { classifyTenantHost } from "@/lib/auth/tenant-host";
import type { PortalInvite, PortalSite } from "./types";
import { getServerT } from "@/lib/i18n/server";

export const PORTAL_SLUG = /^[a-z0-9-]{1,80}$/;
const INVITE_TOKEN = /^[A-Za-z0-9_-]{20,100}$/;
/** The signed-in client's session, per portal. */
export const portalCookie = (slug: string) => `wodana_client_${slug}`;

/** The portal's public face (brand, welcome, region, how codes are sent), or null when it isn't open. */
export async function loadSite(slug: string): Promise<PortalSite | null> {
  if (!PORTAL_SLUG.test(slug)) return null;
  const response = await fetch(businessApiUrl(`/client-portal/${slug}/site`), { cache: "no-store", signal: AbortSignal.timeout(8_000) }).catch(() => null);
  if (!response) throw new Error((await getServerT())("The portal is temporarily unavailable. Please try again."));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error((await getServerT())("The portal is temporarily unavailable. Please try again."));
  return response.json() as Promise<PortalSite>;
}

/** What an invitation link (?invite=…) opens: the client's number ready, or an expired link; null when there is no usable token. */
export async function loadInvite(slug: string, token: string | string[] | undefined): Promise<PortalInvite | null> {
  if (typeof token !== "string" || !INVITE_TOKEN.test(token) || !PORTAL_SLUG.test(slug)) return null;
  const response = await fetch(businessApiUrl(`/client-portal/${slug}/invite/${encodeURIComponent(token)}`), { cache: "no-store", signal: AbortSignal.timeout(8_000) }).catch(() => null);
  if (!response) return null;
  if (response.status === 404) return { status: "expired" };
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as PortalInvite | null;
  return body?.status === "valid" && typeof body.phone === "string" ? { status: "valid", name: String(body.name ?? ""), phone: body.phone } : body?.status === "expired" ? body : null;
}

/** The portal a tenant's own domain or its sign-in subdomain opens, without a link. */
export async function slugForHost(host: string | null): Promise<string | null> {
  const classified = classifyTenantHost(host);
  if (classified.kind !== "tenant" && classified.kind !== "custom") return null;
  const path = classified.kind === "tenant" ? `/client-portal-sites/tenant/${encodeURIComponent(classified.slug)}` : `/client-portal-sites/host/${encodeURIComponent(classified.hostname)}`;
  const response = await fetch(businessApiUrl(path), { cache: "no-store", signal: AbortSignal.timeout(8_000) }).catch(() => null);
  if (!response?.ok) return null;
  const body = await response.json().catch(() => null) as { slug?: unknown } | null;
  return typeof body?.slug === "string" && PORTAL_SLUG.test(body.slug) ? body.slug : null;
}

/** The browser tab: the tenant's name and, when they have one, their logo as the icon. */
export function siteMetadata(site: PortalSite | null, fallbackTitle: string) {
  if (!site) return { title: fallbackTitle, robots: { index: false, follow: false } };
  return {
    title: site.brand.name,
    description: site.welcomeText || undefined,
    robots: { index: false, follow: false },
    ...(site.brand.logoUrl ? { icons: { icon: [{ url: site.brand.logoUrl }], apple: [{ url: site.brand.logoUrl }] } } : {}),
  };
}
