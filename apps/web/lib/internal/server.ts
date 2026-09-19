import "server-only";

import { redirect } from "next/navigation";
import { businessApiUrl } from "@/lib/auth/server";
import { getOperatorSession } from "./auth";
import type { ManagedTenant } from "./types";

export async function getInternalPortalData() {
  const session = await getOperatorSession();
  if (!session) redirect("/internal/sign-in");
  const token = process.env.BUSINESS_CORE_INTERNAL_TOKEN;
  if (!token) throw new Error("Internal client management is not configured.");
  const response = await fetch(businessApiUrl("/internal/operator/tenants"), {
    headers: { "x-wodana-internal-token": token, "x-wodana-operator-session": session.token },
    cache: "no-store",
  }).catch(() => null);
  if (!response) throw new Error("The client management service is unavailable.");
  if (!response.ok) throw new Error("Clients could not be loaded.");
  return { operator: session.operator, tenants: await response.json() as ManagedTenant[] };
}
