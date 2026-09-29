import "server-only";

import { cookies } from "next/headers";
import { ACCESS_COOKIE, businessApiUrl } from "@/lib/auth/server";

export type WorkspaceRegion = { locale?: string; currency?: string; timeZone?: string; workingDays?: number[]; holidays?: string[] };

/**
 * The workspace's formatting region (locale, currency, time zone) and working week. Every member's profile
 * carries it; the workspace's settings are read only for an older profile without it. Empty if unavailable.
 */
export async function getWorkspaceRegion(workspaceId: string | undefined, membership?: { workspaceLocale?: string | null; workspaceCurrency?: string | null; workspaceTimezone?: string | null; workspaceWorkingDays?: number[]; workspaceHolidays?: string[] }): Promise<WorkspaceRegion> {
  if (!workspaceId) return {};
  if (membership?.workspaceLocale || membership?.workspaceCurrency || membership?.workspaceTimezone)
    return { locale: membership.workspaceLocale || undefined, currency: membership.workspaceCurrency || undefined, timeZone: membership.workspaceTimezone || undefined,
      ...(membership.workspaceWorkingDays?.length ? { workingDays: membership.workspaceWorkingDays } : {}), ...(membership.workspaceHolidays ? { holidays: membership.workspaceHolidays } : {}) };
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return {};
  const response = await fetch(businessApiUrl(`/workspaces/${workspaceId}`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null);
  if (!response?.ok) return {};
  const payload = await response.json().catch(() => null) as { workspace?: { defaultLocale?: string; defaultCurrency?: string; defaultTimezone?: string } } | null;
  const workspace = payload?.workspace;
  return { locale: workspace?.defaultLocale || undefined, currency: workspace?.defaultCurrency || undefined, timeZone: workspace?.defaultTimezone || undefined };
}
