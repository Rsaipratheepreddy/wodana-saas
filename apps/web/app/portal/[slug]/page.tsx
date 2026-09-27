import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PortalApp } from "@/components/client-portal/portal-app";
import { PortalUnavailable } from "@/components/client-portal/portal-unavailable";
import { loadSite, siteMetadata } from "@/lib/client-portal/server";
import { LANGUAGE_COOKIE, resolveLanguage } from "@/lib/i18n/languages";
import { translator } from "@/lib/i18n/messages";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = translator(resolveLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value));
  return siteMetadata(await loadSite((await params).slug).catch(() => null), t("Your project"));
}

/** A tenant's client portal by its link (/portal/{link}). */
export default async function Page({ params }: Props) {
  const site = await loadSite((await params).slug);
  return site ? <PortalApp site={site} /> : <PortalUnavailable />;
}
