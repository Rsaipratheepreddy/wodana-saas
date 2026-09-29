import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { classifyTenantHost } from "@/lib/auth/tenant-host";

/**
 * The public site (landing, contact sales, about, careers, team) lives only on Wodana's generic hosts. A firm's own
 * host opens its sign-in instead, and a malformed host is not found.
 */
export async function requirePublicHost() {
  const route = classifyTenantHost((await headers()).get("host"));
  if (route.kind === "invalid") notFound();
  if (route.kind !== "generic") redirect("/login");
}
