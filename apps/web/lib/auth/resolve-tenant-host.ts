import "server-only";

import { businessApiUrl } from "./server";
import { classifyTenantHost } from "./tenant-host";
import { getServerT } from "@/lib/i18n/server";

export type TenantBranding = {
  displayName: string; loginSlug: string; logoUrl: string | null; primaryColor: string | null;
  secondaryColor: string | null; headingFont: string | null; bodyFont: string | null;
};

export async function resolveTenantHost(host: string | null): Promise<{ kind: "generic" } | { kind: "tenant"; branding: TenantBranding } | null> {
  const classified = classifyTenantHost(host);
  if (classified.kind === "invalid") return null;
  if (classified.kind === "generic") return classified;
  const path = classified.kind === "tenant"
    ? `/auth/tenant/${encodeURIComponent(classified.slug)}`
    : `/auth/tenant-host/${encodeURIComponent(classified.hostname)}`;
  const response = await fetch(businessApiUrl(path), { cache: "no-store", signal: AbortSignal.timeout(8_000) })
    .catch(() => null);
  if (!response) throw new Error((await getServerT())("The sign-in service is temporarily unavailable."));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error((await getServerT())("The sign-in service is temporarily unavailable."));
  const branding = await response.json() as TenantBranding;
  if (!branding || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(branding.loginSlug)) return null;
  return { kind: "tenant", branding };
}
