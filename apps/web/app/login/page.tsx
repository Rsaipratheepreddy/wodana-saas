import type { Metadata } from "next";
import { headers } from "next/headers";
import { getServerT } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { businessApiUrl } from "@/lib/auth/server";
import { safeNextPath } from "@/lib/auth/next-path";
import { resolveTenantHost, type TenantBranding } from "@/lib/auth/resolve-tenant-host";
import { tenantBackgroundUrl } from "@/lib/auth/tenant-background";
import { LoginScreen } from "./login-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Sign in · Wodana"), description: t("Sign in to your Wodana business workspace.") };
}

async function getTenantBranding(requestedSlug?: string): Promise<TenantBranding> {
  const resolved = await resolveTenantHost((await headers()).get("host"));
  if (!resolved) notFound();
  if (resolved.kind === "tenant") return {
    ...resolved.branding,
    logoUrl: resolved.branding.logoUrl ? `/api/auth/tenant-logo/${resolved.branding.loginSlug}` : null,
    loginBackgroundUrl: tenantBackgroundUrl(resolved.branding.loginSlug, resolved.branding.loginBackgroundUrl),
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
      loginBackgroundUrl: tenantBackgroundUrl(branding.loginSlug, branding.loginBackgroundUrl),
    };
  }
  return {
    displayName: "Wodana", loginSlug, logoUrl: null, primaryColor: null,
    secondaryColor: null, headingFont: null, bodyFont: null, loginBackgroundUrl: null,
  };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string; reset?: string; next?: string; tenant?: string; reason?: string }>;
}) {
  const query = await searchParams;
  const t = await getServerT();
  const tenant = await getTenantBranding(query.tenant);
  const nextPath = safeNextPath(query.next);
  return (
    <LoginScreen
      invitationToken={query.invitation && query.invitation.length <= 256 ? query.invitation : undefined}
      passwordResetToken={!query.invitation && query.reset && /^[A-Za-z0-9_-]{32,256}$/.test(query.reset) ? query.reset : undefined}
      initialStatus={query.reason === "session-unavailable" ? t("The sign-in service is temporarily unavailable. Please try again.")
        : query.reason === "session-ended" ? t("Your session has ended. Please sign in again.")
          : query.reason === "password-reset" ? t("Password updated. Sign in with your new password.") : undefined}
      nextPath={nextPath}
      initialStatusTone={query.reason === "password-reset" ? "info" : "error"}
      tenant={tenant}
    />
  );
}
