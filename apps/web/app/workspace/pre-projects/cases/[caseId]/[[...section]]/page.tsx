import { PlanningApprovals } from "@/components/pre-project/planning-approvals";
import { QuotationBuilderShell } from "@/components/commercial/quotation-builder-shell";
import { QuoteBuilder } from "@/components/quotation/quote-builder";
import { CommercialPage } from '@/components/commercial/commercial-page';
import { getCommercial } from '@/lib/commercial/server';
import { notFound, redirect } from "next/navigation";
import { PreProjectCasePage } from "@/components/pre-project/pre-project-case-page";
import { getPreProject, getCaseContent, getDefinitionPageData, getCaseOverviewData } from "@/lib/pre-project/server";
import { caseRoute, requirementViews, listSearch, caseHref, PRE_PROJECT_ROOT } from "@/lib/pre-project/types";
import Link from "next/link";

export default async function CasePage({ params, searchParams }: {
  params: Promise<{ caseId: string; section?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { caseId, section } = await params;
  const path = `${PRE_PROJECT_ROOT}/cases/${caseId}${section?.length ? `/${section.join("/")}` : ""}`;
  const route = caseRoute(path);
  if (!route) notFound();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") query.set(key, value);
  if (!section?.length) redirect(caseHref(caseId, query, "requirements"));
  // Site photos, plans and measurements now live together on the Site page.
  if (route.section === "measurements" || route.section === "site-layouts") redirect(caseHref(caseId, query, "site"));
  const commercialSection = ['boq','quotations','contracts','payment-plan','variations','approvals','execution-release','client-portal'].includes(route.section);
  const needsCommercialState = commercialSection || route.section === "overview";
  const preparation = requirementViews.some(item=>item.section===route.section)||['designs','site','approvals'].includes(route.section);
  const [record, commercialState, content, definition, overview] = await Promise.all([
    getPreProject(caseId),
    needsCommercialState ? getCommercial(caseId) : undefined,
    preparation ? getCaseContent(caseId,['designs','approvals'].includes(route.section),route.section==='site') : undefined,
    ["definition", "overview", "approvals"].includes(route.section) ? getDefinitionPageData(caseId) : undefined,
    route.section === "overview" ? getCaseOverviewData() : undefined,
  ]);
  if ("error" in record) return <section style={{ padding: "2rem" }}><h1>Planning unavailable</h1><p role="alert">{record.error}</p><Link href={PRE_PROJECT_ROOT}>Back to all planning records</Link></section>;
  if (route.section === "quotations" && query.has("quote") && commercialState && !("error" in commercialState)) {
    if (!commercialState.data.quotes.some(quote => quote.id === query.get("quote"))) notFound();
    const backHref = caseHref(caseId, new URLSearchParams(listSearch(query).toString()), "quotations");
    // The document pages (cover, terms, PDF) until the document styles are rebuilt; the lines are built in the quotation builder.
    if (query.get("view") === "document") return <QuotationBuilderShell key={query.get("quote")!} initial={commercialState} quoteId={query.get("quote")!} backHref={`${backHref.split("?")[0]}?quote=${encodeURIComponent(query.get("quote")!)}`} />;
    return <QuoteBuilder key={query.get("quote")!} workspaceId={commercialState.workspaceId} caseId={caseId} quoteId={query.get("quote")!} backHref={backHref} initialTab={query.get("tab") === "document" ? "document" : "items"} />;
  }
  if (route.section === "approvals" && content && definition && commercialState) return <PlanningApprovals record={record} content={content} definition={definition} commercial={commercialState} search={listSearch(query).toString()} review={query.get("review") ?? undefined} />;
  if(commercialSection && commercialState)return <CommercialPage key={`${caseId}-${route.section}-${query.get("quote")??"list"}`} quotationId={query.get("quote")??undefined} initial={commercialState} record={record} section={route.section} search={listSearch(query).toString()}/>;
  return <PreProjectCasePage commercial={commercialState} content={content} definition={definition} overview={overview} record={record} section={route.section} search={listSearch(query).toString()} siteItem={query.get('item')??undefined} />;
}
