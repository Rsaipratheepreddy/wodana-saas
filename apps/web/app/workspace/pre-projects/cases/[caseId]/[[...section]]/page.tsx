import { CommercialPage } from '@/components/commercial/commercial-page';
import { getCommercial } from '@/lib/commercial/server';
import { notFound, redirect } from "next/navigation";
import { PreProjectCasePage } from "@/components/pre-project/pre-project-case-page";
import { getPreProject, getCaseContent } from "@/lib/pre-project/server";
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
  if (!section?.length || section[0] === "overview") redirect(caseHref(caseId, query));
  if (route.section === "measurements" || route.section === "site-layouts") {
    const destination = caseHref(caseId, query, 'requirements');
    redirect(`${destination}${destination.includes('?') ? '&' : '?'}tab=${route.section === 'measurements' ? 'measurements' : 'site-plan'}`);
  }
  const commercial = ['boq','quotations','contracts','payment-plan','variations','approvals','execution-release','client-portal'].includes(route.section);
  const preparation = requirementViews.some(item=>item.section===route.section)||['designs','site'].includes(route.section);
  const [record, commercialState, content] = await Promise.all([
    getPreProject(caseId),
    commercial ? getCommercial(caseId) : undefined,
    preparation ? getCaseContent(caseId,route.section==='designs',route.section==='site') : undefined,
  ]);
  if ("error" in record) return <section style={{ padding: "2rem" }}><h1>Pre-execution unavailable</h1><p role="alert">{record.error}</p><Link href={PRE_PROJECT_ROOT}>Back to all pre-execution records</Link></section>;
  if(commercialState)return <CommercialPage key={`${caseId}-${route.section}-${query.get("quote")??"list"}`} quotationId={query.get("quote")??undefined} initial={commercialState} record={record} section={route.section} search={listSearch(query).toString()}/>;
  return <PreProjectCasePage content={content} record={record} section={route.section} search={listSearch(query).toString()} siteItem={query.get('item')??undefined} />;
}
