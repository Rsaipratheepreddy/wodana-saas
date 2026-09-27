import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { QuotationPrint } from "@/components/commercial/quotation-print";
import { businessApiUrl } from "@/lib/auth/server";
import { documentQuote } from "@/lib/client-portal/document-quote";
import { PORTAL_SLUG, portalCookie } from "@/lib/client-portal/server";
import type { PortalView } from "@/lib/client-portal/types";

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
  return <QuotationPrint quote={documentQuote(quote)} customer={view.contact.name} />;
}
