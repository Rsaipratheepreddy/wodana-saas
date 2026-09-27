import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { QuotationPrint } from "@/components/commercial/quotation-print";
import { businessApiUrl } from "@/lib/auth/server";
import { documentQuote, siteBrand } from "@/lib/client-portal/document-quote";
import { loadSite, PORTAL_SLUG, portalCookie, siteMetadata } from "@/lib/client-portal/server";
import type { PortalView } from "@/lib/client-portal/types";
import { LANGUAGE_COOKIE, resolveLanguage } from "@/lib/i18n/languages";
import { translator } from "@/lib/i18n/messages";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const t = translator(resolveLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value));
  return siteMetadata(await loadSite((await params).slug).catch(() => null), t("Quotation"));
}

/** A quotation from the portal, as issued, ready to print or save as PDF (only the exact snapshot the client opened). */
export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ case?: string; quote?: string; snapshot?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  if (!PORTAL_SLUG.test(slug)) notFound();
  const token = (await cookies()).get(portalCookie(slug))?.value;
  if (!token) redirect(`/portal/${slug}`);
  const response = await fetch(businessApiUrl(`/client-portal/${slug}/view`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null);
  if (!response?.ok) redirect(`/portal/${slug}`);
  const view = await response.json() as PortalView;
  const project = view.projects.find((item) => item.id === query.case);
  const quote = project?.decisions?.quotes.find((item) => item.id === query.quote);
  if (!project || !quote || (query.snapshot && query.snapshot !== quote.hash)) notFound();
  const site = quote.brand ? null : await loadSite(slug).catch(() => null);
  return <QuotationPrint quote={documentQuote(quote, site ? siteBrand(site) : undefined)} customer={view.contact.name} />;
}
