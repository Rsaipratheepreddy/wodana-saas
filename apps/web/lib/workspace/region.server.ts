import "server-only";

import { cookies } from "next/headers";
import { ACCESS_COOKIE, businessApiUrl } from "@/lib/auth/server";

export type WorkspaceRegion = { locale?: string; currency?: string; timeZone?: string };

/** The workspace's formatting region (locale, currency, time zone) from its settings; empty if unavailable. */
export async function getWorkspaceRegion(workspaceId: string | undefined): Promise<WorkspaceRegion> {
  if (!workspaceId) return {};
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return {};
  const response = await fetch(businessApiUrl(`/workspaces/${workspaceId}`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null);
  if (!response?.ok) return {};
  const payload = await response.json().catch(() => null) as { workspace?: { defaultLocale?: string; defaultCurrency?: string; defaultTimezone?: string } } | null;
  const workspace = payload?.workspace;
  return { locale: workspace?.defaultLocale || undefined, currency: workspace?.defaultCurrency || undefined, timeZone: workspace?.defaultTimezone || undefined };
}
