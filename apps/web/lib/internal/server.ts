import "server-only";

import { redirect } from "next/navigation";
import { businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";
import type { ManagedTenant } from "./types";

export async function getInternalPortalData() {
  const profile = await getAuthenticatedProfile();
  if (profile.platformRole !== "administrator") redirect("/workspace");
  const token = process.env.BUSINESS_CORE_INTERNAL_TOKEN;
  if (!token) throw new Error("Internal client management is not configured.");
  const response = await fetch(businessApiUrl("/internal/tenants"), {
    headers: { "x-wodana-internal-token": token },
    cache: "no-store",
  }).catch(() => null);
  if (!response) throw new Error("The client management service is unavailable.");
  if (!response.ok) throw new Error("Clients could not be loaded.");
  return { profile, tenants: await response.json() as ManagedTenant[] };
}
