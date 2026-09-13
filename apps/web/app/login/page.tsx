import type { Metadata } from "next";
import { LoginScreen } from "./login-screen";

export const metadata: Metadata = {
  title: "Sign in · Wodana",
  description: "Sign in to your Wodana business workspace.",
};

type TenantBranding = { displayName: string; loginSlug: string; logoUrl: string | null };

async function getTenantBranding(requestedSlug?: string): Promise<TenantBranding> {
  const loginSlug = requestedSlug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug)
    ? requestedSlug
    : process.env.LOGIN_TENANT_SLUG ?? "iglo-architects";
  const base = process.env.BUSINESS_CORE_URL
    ?? process.env.NEXT_PUBLIC_BUSINESS_API_URL
    ?? "http://127.0.0.1:8000/api/v1";
  const response = await fetch(`${base.replace(/\/$/, "")}/auth/tenant/${loginSlug}`, {
    cache: "no-store",
  }).catch(() => null);
  if (response?.ok) {
    const branding = await response.json() as TenantBranding;
    return {
      ...branding,
      logoUrl: branding.logoUrl ? `/api/auth/tenant-logo/${branding.loginSlug}` : null,
    };
  }
  return { displayName: "Iglo Architects", loginSlug, logoUrl: null };
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
      demoCredentials={process.env.NODE_ENV === "production" ? undefined : {
        email: "admin@igloarchitects.com",
        password: "IgloDemo#2026",
      }}
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
