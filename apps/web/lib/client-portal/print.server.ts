import "server-only";

import { cookies } from "next/headers";
import { businessApiUrl } from "@/lib/auth/server";
import { loadSite, PORTAL_SLUG, portalCookie } from "./server";
import type { PortalSite, PortalView } from "./types";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The portal and the signed-in client's own view, for a printout of one of its records: "sign-in" when the client
 * has no session, null when the portal or the record's id isn't valid.
 */
export async function loadPortalView(slug: string, recordId: string): Promise<{ site: PortalSite; view: PortalView } | "sign-in" | null> {
  if (!PORTAL_SLUG.test(slug) || !ID.test(recordId)) return null;
  const token = (await cookies()).get(portalCookie(slug))?.value;
  if (!token) return "sign-in";
  const [site, response] = await Promise.all([loadSite(slug).catch(() => null),
    fetch(businessApiUrl(`/client-portal/${slug}/view`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null)]);
  if (response?.status === 401) return "sign-in";
  if (!site || !response?.ok) return null;
  return { site, view: await response.json() as PortalView };
}
