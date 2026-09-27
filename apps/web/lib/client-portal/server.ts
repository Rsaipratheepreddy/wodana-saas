import "server-only";

import { businessApiUrl } from "@/lib/auth/server";
import { classifyTenantHost } from "@/lib/auth/tenant-host";
import type { PortalSite } from "./types";

export const PORTAL_SLUG = /^[a-z0-9-]{1,80}$/;
/** The signed-in client's session, per portal. */
export const portalCookie = (slug: string) => `wodana_client_${slug}`;

/** The portal's public face (brand, welcome, region, how codes are sent), or null when it isn't open. */
export async function loadSite(slug: string): Promise<PortalSite | null> {
  if (!PORTAL_SLUG.test(slug)) return null;
  const response = await fetch(businessApiUrl(`/client-portal/${slug}/site`), { cache: "no-store", signal: AbortSignal.timeout(8_000) }).catch(() => null);
  if (!response) throw new Error("The portal is temporarily unavailable. Please try again.");
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The portal is temporarily unavailable. Please try again.");
  return response.json() as Promise<PortalSite>;
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
