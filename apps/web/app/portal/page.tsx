import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { PortalApp } from "@/components/client-portal/portal-app";
import { PortalUnavailable } from "@/components/client-portal/portal-unavailable";
import { loadSite, siteMetadata, slugForHost } from "@/lib/client-portal/server";
import { LANGUAGE_COOKIE, resolveLanguage } from "@/lib/i18n/languages";
import { translator } from "@/lib/i18n/messages";

async function site() {
  const slug = await slugForHost((await headers()).get("host"));
  return slug ? loadSite(slug) : null;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(resolveLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value));
  return siteMetadata(await site().catch(() => null), t("Your project"));
}

/** The client portal on the tenant's own domain or sign-in subdomain: no link needed. */
export default async function Page() {
  const found = await site();
  return found ? <PortalApp site={found} /> : <PortalUnavailable />;
}
