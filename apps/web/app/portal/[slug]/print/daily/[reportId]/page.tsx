import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PortalProgressPrint } from "@/components/client-portal/portal-progress-print";
import { loadPortalView } from "@/lib/client-portal/print.server";
import { portalDayPrint } from "@/lib/client-portal/progress-print";
import { loadSite, siteMetadata } from "@/lib/client-portal/server";
import { LANGUAGE_COOKIE, resolveLanguage } from "@/lib/i18n/languages";
import { translator } from "@/lib/i18n/messages";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const t = translator(resolveLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value));
  return siteMetadata(await loadSite((await params).slug).catch(() => null), t("Daily progress"));
}

/**
 * A day the team sent, from the client's own portal view (only what the client may read), ready to print or save
 * as PDF in the firm's name.
 */
export default async function Page({ params }: { params: Promise<{ slug: string; reportId: string }> }) {
  const { slug, reportId } = await params;
  const loaded = await loadPortalView(slug, reportId);
  if (loaded === "sign-in") redirect(`/portal/${slug}`);
  const data = loaded ? portalDayPrint(loaded.view, loaded.site, reportId) : null;
  if (!loaded || !data) notFound();
  return <PortalProgressPrint site={loaded.site} kind="day" data={data} />;
}
