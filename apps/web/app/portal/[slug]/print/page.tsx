import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { QuotationPrint } from "@/components/commercial/quotation-print";
import { PortalDocumentPrint } from "@/components/client-portal/portal-document-print";
import { businessApiUrl } from "@/lib/auth/server";
import { documentQuote, siteBrand } from "@/lib/client-portal/document-quote";
import { loadSite, PORTAL_SLUG, portalCookie, siteMetadata } from "@/lib/client-portal/server";
import type { PortalInvoiceDocument, PortalQuote, PortalReceiptDocument, PortalSite, PortalView } from "@/lib/client-portal/types";
import { LANGUAGE_COOKIE, resolveLanguage } from "@/lib/i18n/languages";
import { translator } from "@/lib/i18n/messages";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ invoice?: string; receipt?: string }> }): Promise<Metadata> {
  const t = translator(resolveLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value));
  const query = await searchParams;
  return siteMetadata(await loadSite((await params).slug).catch(() => null), query.invoice ? t("Tax invoice") : query.receipt ? t("Payment receipt") : t("Quotation"));
}

/**
 * A document from the portal, ready to print or save as PDF: a quotation exactly as issued (only the snapshot the
 * client opened), or one of the client's tax invoices or receipts. The proposal PDF is printed from this same page:
 * the server opens it with a short-lived print link for one quotation snapshot, instead of the client's session.
 */
export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ case?: string; quote?: string; snapshot?: string; invoice?: string; receipt?: string; token?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  if (!PORTAL_SLUG.test(slug)) notFound();
  if (query.token) {
    if (query.token.length > 2000) notFound();
    const response = await fetch(businessApiUrl(`/print/proposals/${encodeURIComponent(query.token)}`), { cache: "no-store" }).catch(() => null);
    if (!response?.ok) notFound();
    const printed = await response.json() as { quote: PortalQuote; customer: string; site: PortalSite };
    return <div data-print-ready=""><QuotationPrint quote={documentQuote(printed.quote, printed.quote.brand ? undefined : siteBrand(printed.site))} customer={printed.customer} /></div>;
  }
  const token = (await cookies()).get(portalCookie(slug))?.value;
  if (!token) redirect(`/portal/${slug}`);
  const headers = { authorization: `Bearer ${token}` };
  if (query.invoice || query.receipt) {
    const kind = query.invoice ? "invoice" : "receipt";
    const id = query.invoice ?? query.receipt ?? "";
    if (!ID.test(query.case ?? "") || !ID.test(id)) notFound();
    const [site, response] = await Promise.all([loadSite(slug).catch(() => null),
      fetch(businessApiUrl(`/client-portal/${slug}/cases/${query.case}/documents/${kind}/${id}`), { headers, cache: "no-store" }).catch(() => null)]);
    if (response?.status === 401) redirect(`/portal/${slug}`);
    if (!site || !response?.ok) notFound();
    const document = await response.json() as { kind: "invoice"; invoice: PortalInvoiceDocument } | { kind: "receipt"; receipt: PortalReceiptDocument };
    return <PortalDocumentPrint site={site} document={document} />;
  }
  const response = await fetch(businessApiUrl(`/client-portal/${slug}/view`), { headers, cache: "no-store" }).catch(() => null);
  if (!response?.ok) redirect(`/portal/${slug}`);
  const view = await response.json() as PortalView;
  const project = view.projects.find((item) => item.id === query.case);
  const quote = project?.decisions?.quotes.find((item) => item.id === query.quote);
  if (!project || !quote || (query.snapshot && query.snapshot !== quote.hash)) notFound();
  const site = quote.brand ? null : await loadSite(slug).catch(() => null);
  return <QuotationPrint quote={documentQuote(quote, site ? siteBrand(site) : undefined)} customer={view.contact.name} />;
}
