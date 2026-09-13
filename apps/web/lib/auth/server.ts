import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const ACCESS_COOKIE = "wodana_access";
export const REFRESH_COOKIE = "wodana_refresh";
export const TENANT_COOKIE = "wodana_tenant";
export const ACTIVE_WORKSPACE_COOKIE = "wodana_workspace";

export type AuthProfile = {
  id: string;
  primaryEmail: string;
  displayName: string;
  platformRole?: "administrator" | null;
  memberships: Array<{
    workspaceId: string;
    workspaceName: string;
    workspaceSlug: string;
    workspaceLogoUrl: string | null;
    roles: string[];
  }>;
  nextAction: string;
};

export function businessApiUrl(path: string) {
  const base = process.env.BUSINESS_CORE_URL
    ?? process.env.NEXT_PUBLIC_BUSINESS_API_URL
    ?? "http://127.0.0.1:8000/api/v1";
  return `${base.replace(/\/$/, "")}${path}`;
}

export function intelligenceApiUrl(path: string) {
  const base = process.env.INTELLIGENCE_API_URL
    ?? process.env.NEXT_PUBLIC_INTELLIGENCE_API_URL
    ?? "http://127.0.0.1:8001/api/v1";
  return `${base.replace(/\/$/, "")}${path}`;
}

export const authCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  priority: "high" as const,
};

// Share authentication work within one render, never between users or requests.
export const getAuthenticatedProfile = cache(async (): Promise<AuthProfile> => {
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      primaryEmail: "admin@igloarchitects.com",
      displayName: "Iglo Administrator",
      platformRole: "administrator",
      nextAction: "enter_workspace",
      memberships: [{
        workspaceId: "00000000-0000-4000-8000-000000000002",
        workspaceName: "Iglo Architects",
        workspaceSlug: "iglo-architects",
        workspaceLogoUrl: null,
        roles: ["owner"],
      }],
    };
  }
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const response = await fetch(businessApiUrl("/me"), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!response?.ok) redirect(`/login?reason=${response?.status === 401 ? "session-ended" : "session-unavailable"}`);
  const profile = await response.json() as AuthProfile;
  const selected = (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value;
  // Only an authorized membership may become the active workspace.
  const active = profile.memberships.find((membership) => membership.workspaceId === selected);
  return active ? { ...profile, memberships: [active, ...profile.memberships.filter((membership) => membership !== active)] } : profile;
});

export function safeBackendMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const message = (payload as { message?: unknown }).message;
  if (Array.isArray(message)) return message.filter((item) => typeof item === "string").join(" ");
  if (typeof message === "string") return message;
  const nestedMessage = (payload as { error?: { message?: unknown } }).error?.message;
  return typeof nestedMessage === "string" ? nestedMessage : fallback;
}
