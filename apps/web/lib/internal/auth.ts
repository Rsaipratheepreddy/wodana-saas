import "server-only";

import { cookies } from "next/headers";
import { businessApiUrl } from "@/lib/auth/server";

export const OPERATOR_COOKIE = "wodana_operator";

export type OperatorProfile = {
  userId: string;
  email: string;
  displayName: string;
  expiresAt: string;
  role: "administrator" | "platform_security_owner" | "provisioning_operator" | "account_billing_operator" | "domain_operator" | "support_observer";
  permissions: OperatorPermission[];
};

export type OperatorPermission =
  | "tenants.read"
  | "tenants.provision"
  | "invitations.send"
  | "billing.manage"
  | "lifecycle.manage"
  | "domains.manage"
  | "entitlements.manage"
  | "support.request"
  | "support.approve"
  | "data.manage"
  | "operators.manage";

export async function getOperatorSession() {
  const token = (await cookies()).get(OPERATOR_COOKIE)?.value;
  if (!token) return null;
  const response = await fetch(businessApiUrl("/auth/platform/session"), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const operator = await response.json().catch(() => null) as OperatorProfile | null;
  return operator ? { token, operator } : null;
}

export function operatorCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
    priority: "high" as const,
  };
}
