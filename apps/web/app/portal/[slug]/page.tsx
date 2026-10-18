import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PortalApp } from "@/components/client-portal/portal-app";
import { PortalUnavailable } from "@/components/client-portal/portal-unavailable";
import { loadInvite, loadSite, siteMetadata } from "@/lib/client-portal/server";
import { LANGUAGE_COOKIE, resolveLanguage } from "@/lib/i18n/languages";
import { translator } from "@/lib/i18n/messages";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ invite?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = translator(resolveLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value));
  return siteMetadata(await loadSite((await params).slug).catch(() => null), t("Your project"));
}

/** A tenant's client portal by its link (/portal/{link}); an invitation link opens it with the client's number ready. */
export default async function Page({ params, searchParams }: Props) {
  const { slug } = await params;
  const site = await loadSite(slug);
  if (!site) return <PortalUnavailable />;
  return <PortalApp site={site} invite={await loadInvite(slug, (await searchParams).invite)} />;
}
