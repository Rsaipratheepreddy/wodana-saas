import "server-only";

import { cookies } from "next/headers";
import { ACCESS_COOKIE, businessApiUrl, type AuthProfile } from "@/lib/auth/server";
import { VIEW_AS_PERMISSION, type ViewAsActivity, type ViewAsSettings } from "./view-as";

export type ViewAsReadiness = {
  /** The signed-in person may start a view (and is not in one already: views don't chain). */
  canViewAs: boolean;
  /** Starting a view asks for an authenticator code, so two-step verification must be on. */
  mfaEnabled: boolean;
  settings: ViewAsSettings | null;
};

async function read<T>(path: string): Promise<T | null> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const response = await fetch(businessApiUrl(path), { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8_000) }).catch(() => null);
  return response?.ok ? await response.json().catch(() => null) as T | null : null;
}

/** What People and Roles need to offer "View as" / "Preview as": the permission, MFA and the notice setting. */
export async function getViewAsReadiness(profile: AuthProfile): Promise<ViewAsReadiness> {
  const membership = profile.memberships[0];
  // Only the owner views as someone else (the server refuses anyone else, whatever their role was granted).
  const canViewAs = Boolean(membership?.allowedPermissions?.includes(VIEW_AS_PERMISSION)) && Boolean(membership?.roles?.includes("owner")) && !profile.viewAs;
  if (!membership || !canViewAs) return { canViewAs: false, mfaEnabled: false, settings: null };
  const [mfa, settings] = await Promise.all([
    read<{ enabled?: boolean }>(`/security/mfa/status?workspaceId=${membership.workspaceId}`),
    read<ViewAsSettings>(`/workspaces/${membership.workspaceId}/view-as/settings`),
  ]);
  return { canViewAs, mfaEnabled: mfa?.enabled === true, settings };
}

/** Who viewed the workspace as the signed-in person (Security > Activity). Empty while viewing as someone. */
export async function getViewAsActivity(workspaceId: string, viewing: boolean): Promise<ViewAsActivity[]> {
  if (viewing) return [];
  const found = await read<{ sessions?: ViewAsActivity[] }>(`/workspaces/${workspaceId}/view-as/about-me`);
  return found?.sessions ?? [];
}
