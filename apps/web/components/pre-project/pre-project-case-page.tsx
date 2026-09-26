"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {useSearchParams} from "next/navigation";
import { workspaceModules } from "@/components/workspace/workspace-navigation";
import { caseHref, requirementViews, type PreProjectCase } from "@/lib/pre-project/types";
import { usePreProject } from "./pre-project-context";
import { Button,Callout,DesignSystemProvider,StageHeader,useDesignSystem } from "@/design-system";
import { BriefScopePage } from "./brief-scope-page";
import { useWoddyRecord } from "@/components/crm/woddy-chat";
import { PreProjectSectionLoading } from "./section-loading";
import type { SiteData } from "@/lib/pre-project/site";
import type { CaseContent,CaseDesign,DesignOptions } from "@/lib/pre-project/content";
import type { DefinitionPageData } from "@/lib/pre-project/definition";
import type { CommercialState } from "@/lib/commercial/types";
import { DefinitionPage } from "./definition-page";
import { CaseOverview } from "./case-overview";
import tableStyles from "../crm/leads-page.module.css";
import workspaceColors from "../crm/crm-workspace-colors.module.css";
import styles from "./pre-project.module.css";

const DesignsPage = dynamic(() => import('./designs-page').then(module => module.DesignsPage), { loading: PreProjectSectionLoading });
const SitePage = dynamic(() => import('./site-page').then(module => module.SitePage), { loading: PreProjectSectionLoading });

export function PreProjectCasePage({ record, section, search, content, definition, commercial, overview, siteItem }: { record: PreProjectCase; section: string; search: string; siteItem?:string; definition?:DefinitionPageData; commercial?:CommercialState; overview?:{workspaceId:string;members:{id:string;displayName:string}[]}; content?:{data:CaseContent;designs:CaseDesign[];designOptions?:DesignOptions;site?:SiteData}|{error:string} }) {
  const design=useDesignSystem();
  const designFile=useSearchParams().get('file');
  const [portalContainer,setPortalContainer]=useState<HTMLElement|null>(null);
  const [liveRecord,setLiveRecord]=useState(record);
  const currentRecord=liveRecord.id===record.id?liveRecord:record;
  const { setSelected } = usePreProject();
  useEffect(() => { setSelected({ record:currentRecord, search }); }, [currentRecord, search, setSelected]);
  useWoddyRecord("pre-project", currentRecord.id, `${currentRecord.customerName} · ${currentRecord.title}`);
  const screen = workspaceModules.find((module) => module.id === "pre-project")!.navigation.flatMap((group) => group.items).find((item) => item.href.endsWith(`/${section}`));
  const gatheringView=requirementViews.find(item=>item.section===section);
  const compact=Boolean(gatheringView)||['designs','site','definition','overview'].includes(section);
  const link = (tab: string) => caseHref(currentRecord.id, new URLSearchParams(search), tab);
  return <DesignSystemProvider {...design} className={`${workspaceColors.theme} ${tableStyles.provider} ${styles.caseProvider}`} currency={content&&"data" in content?content.data.brief.currencyCode:design.currency} portalContainer={portalContainer}><section ref={setPortalContainer} data-requirements={Boolean(gatheringView) || undefined} className={`${styles.casePage} ${compact?styles.compactCase:''}`}>
    {!gatheringView && section !== "designs" && section !== "overview" && !(section==='designs'&&designFile)&&<StageHeader description={screen?.description} readOnly={Boolean(content&&"data" in content&&!content.data.canEdit)} title={screen?.label ?? "Case overview"} />}
    {!gatheringView&&section!=="designs"&&content&&"data" in content&&!content.data.canEdit&&<Callout tone="info" title={currentRecord.status==='released'?'Released planning · Read only':currentRecord.status==='cancelled'?'Cancelled planning · Read only':'View-only access'}>{currentRecord.status==='released'?'This case has been released to execution. Its requirements, measurements and design records are kept as the agreed reference.':currentRecord.status==='cancelled'?'This case is cancelled. Its preparation records are available for reference.':'Your workspace role can view this case but cannot edit its preparation records.'} <Link href="/workspace/pre-projects">Open an active planning</Link></Callout>}
    {section === "overview" && overview ? <CaseOverview record={currentRecord} workspaceId={overview.workspaceId} members={overview.members} progress={definition} commercial={commercial} onUpdated={setLiveRecord} /> : section === "definition" && definition ? <DefinitionPage initial={definition} /> : content&&"error" in content?<div role="alert"><p>{content.error}</p><Button size="compact" onPress={()=>window.location.reload()}>Reload section</Button></div>:content&&"data" in content&&gatheringView?<BriefScopePage key={`${currentRecord.id}-${section}-${search}`} initialData={content.data}  view={gatheringView.view}/>:content&&"data" in content&&section==='designs'?<DesignsPage  ownerName={currentRecord.engagementOwnerName ?? currentRecord.leadManagerName} key={currentRecord.id} initialData={content.data} initialDesigns={content.designs} options={content.designOptions}/>:content&&'data' in content&&section==='site'&&content.site?<SitePage key={currentRecord.id} initialData={content.data} initialSite={content.site} initialItem={siteItem}/>:<div className={styles.planned}><span className={styles.badge}>Planned section</span><h2>{screen?.label} for this planning</h2><p>This section is scoped to <strong>{currentRecord.title}</strong>. Its forms and approval workflows will be implemented section by section.</p><Link href={link("overview")}>Back to case overview</Link></div>}
  </section></DesignSystemProvider>;
}
