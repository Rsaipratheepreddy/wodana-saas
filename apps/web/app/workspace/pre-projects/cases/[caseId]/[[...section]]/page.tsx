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
  if (!section?.length) redirect(caseHref(caseId, query, "overview"));
  if (route.section === "measurements" || route.section === "site-layouts") {
    const destination = caseHref(caseId, query, 'requirements');
    redirect(`${destination}${destination.includes('?') ? '&' : '?'}tab=${route.section === 'measurements' ? 'measurements' : 'site-plan'}`);
  }
  const commercialSection = ['boq','quotations','contracts','payment-plan','variations','approvals','execution-release','client-portal'].includes(route.section);
  const needsCommercialState = commercialSection || route.section === "overview";
  const preparation = requirementViews.some(item=>item.section===route.section)||['designs','site'].includes(route.section);
  const [record, commercialState, content, definition, overview] = await Promise.all([
    getPreProject(caseId),
    needsCommercialState ? getCommercial(caseId) : undefined,
    preparation ? getCaseContent(caseId,route.section==='designs',route.section==='site') : undefined,
    ["definition", "overview"].includes(route.section) ? getDefinitionPageData(caseId) : undefined,
    route.section === "overview" ? getCaseOverviewData() : undefined,
  ]);
  if ("error" in record) return <section style={{ padding: "2rem" }}><h1>Pre-execution unavailable</h1><p role="alert">{record.error}</p><Link href={PRE_PROJECT_ROOT}>Back to all pre-execution records</Link></section>;
  if(commercialSection && commercialState)return <CommercialPage key={`${caseId}-${route.section}-${query.get("quote")??"list"}`} quotationId={query.get("quote")??undefined} initial={commercialState} record={record} section={route.section} search={listSearch(query).toString()}/>;
  return <PreProjectCasePage commercial={commercialState} content={content} definition={definition} overview={overview} record={record} section={route.section} search={listSearch(query).toString()} siteItem={query.get('item')??undefined} />;
}
