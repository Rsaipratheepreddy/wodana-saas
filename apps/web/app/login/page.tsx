import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { businessApiUrl } from "@/lib/auth/server";
import { resolveTenantHost, type TenantBranding } from "@/lib/auth/resolve-tenant-host";
import { LoginScreen } from "./login-screen";

export const metadata: Metadata = {
  title: "Sign in · Wodana",
  description: "Sign in to your Wodana business workspace.",
};

async function getTenantBranding(requestedSlug?: string): Promise<TenantBranding> {
  const resolved = await resolveTenantHost((await headers()).get("host"));
  if (!resolved) notFound();
  if (resolved.kind === "tenant") return {
    ...resolved.branding,
    logoUrl: resolved.branding.logoUrl ? `/api/auth/tenant-logo/${resolved.branding.loginSlug}` : null,
  };
  const loginSlug = requestedSlug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug)
    ? requestedSlug
    : process.env.LOGIN_TENANT_SLUG ?? "";
  const response = await fetch(businessApiUrl(`/auth/tenant/${loginSlug}`), {
    cache: "no-store",
  }).catch(() => null);
  if (response?.ok) {
    const branding = await response.json() as TenantBranding;
    return {
      ...branding,
      logoUrl: branding.logoUrl ? `/api/auth/tenant-logo/${branding.loginSlug}` : null,
    };
  }
  return {
    displayName: "Wodana", loginSlug, logoUrl: null, primaryColor: null,
    secondaryColor: null, headingFont: null, bodyFont: null,
  };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string; reset?: string; next?: string; tenant?: string; reason?: string }>;
}) {
  const query = await searchParams;
  const tenant = await getTenantBranding(query.tenant);
  const nextPath = query.next?.startsWith("/workspace") || query.next?.startsWith("/internal") ? query.next : "/workspace";
  return (
    <LoginScreen
      invitationToken={query.invitation && query.invitation.length <= 256 ? query.invitation : undefined}
      passwordResetToken={!query.invitation && query.reset && /^[A-Za-z0-9_-]{32,256}$/.test(query.reset) ? query.reset : undefined}
      initialStatus={query.reason === "session-unavailable" ? "The sign-in service is temporarily unavailable. Please try again."
        : query.reason === "session-ended" ? "Your session has ended. Please sign in again."
          : query.reason === "password-reset" ? "Password updated. Sign in with your new password." : undefined}
      nextPath={nextPath}
      tenant={tenant}
    />
  );
}
