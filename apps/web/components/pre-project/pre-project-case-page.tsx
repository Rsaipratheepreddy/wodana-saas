"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {useSearchParams} from "next/navigation";
import { ArrowUpRight, ClipboardList, Palette, ShieldCheck } from "lucide-react";
import { workspaceModules } from "@/components/workspace/workspace-navigation";
import { caseHref, requirementViews, type PreProjectCase } from "@/lib/pre-project/types";
import { usePreProject } from "./pre-project-context";
import { Callout,DesignSystemProvider,useDesignSystem } from "@/design-system";
import { BriefScopePage } from "./brief-scope-page";
import { PreProjectSectionLoading } from "./section-loading";
import type { SiteData } from "@/lib/pre-project/site";
import type { CaseContent,CaseDesign,DesignOptions } from "@/lib/pre-project/content";
import tableStyles from "../crm/leads-page.module.css";
import workspaceColors from "../crm/crm-workspace-colors.module.css";
import styles from "./pre-project.module.css";

const DesignsPage = dynamic(() => import('./designs-page').then(module => module.DesignsPage), { loading: PreProjectSectionLoading });
const SitePage = dynamic(() => import('./site-page').then(module => module.SitePage), { loading: PreProjectSectionLoading });

export function PreProjectCasePage({ record, section, search, content, siteItem }: { record: PreProjectCase; section: string; search: string; siteItem?:string; content?:{data:CaseContent;designs:CaseDesign[];designOptions?:DesignOptions;site?:SiteData}|{error:string} }) {
  const design=useDesignSystem();
  const designFile=useSearchParams().get('file');
  const [portalContainer,setPortalContainer]=useState<HTMLElement|null>(null);
  const { setSelected } = usePreProject();
  // The shell checks the route's case id; retain its title while the next section streams.
  useEffect(() => { setSelected({ record, search }); }, [record, search, setSelected]);
  const screen = workspaceModules.find((module) => module.id === "pre-project")!.navigation.flatMap((group) => group.items).find((item) => item.href.endsWith(`/${section}`));
  const gatheringView=requirementViews.find(item=>item.section===section);
  const compact=Boolean(gatheringView)||section==='designs'||section==='site';
  const link = (tab: string) => caseHref(record.id, new URLSearchParams(search), tab);
  return <DesignSystemProvider {...design} className={`${workspaceColors.theme} ${tableStyles.provider} ${styles.caseProvider}`} currency={content&&"data" in content?content.data.brief.currencyCode:design.currency} portalContainer={portalContainer}><section ref={setPortalContainer} className={`${styles.casePage} ${compact?styles.compactCase:''}`}>
    {!(section==='designs'&&designFile)&&<header className={styles.heading}><div>{!compact&&<p className={styles.eyebrow}>{record.customerName}</p>}<h1>{section === "overview" ? "Overview" : screen?.label}</h1>{!compact&&<p>{section === "overview" ? record.title : screen?.description}</p>}</div><span className={styles.badge}>{record.status === "active" ? "In progress" : record.status}</span></header>}
    {content&&"data" in content&&!content.data.canEdit&&<Callout tone="info" title={record.status==='released'?'Released pre-execution · Read only':record.status==='archived'?'Archived pre-execution · Read only':'View-only access'}>{record.status==='released'?'This case has been released to execution. Its requirements, measurements and design records are kept as the agreed reference.':record.status==='archived'?'This case is archived. Its preparation records are available for reference.':'Your workspace role can view this case but cannot edit its preparation records.'} <Link href="/workspace/pre-projects">Open an active pre-execution</Link></Callout>}
    {content&&"error" in content?<div role="alert"><p>{content.error}</p><button className={styles.control} onClick={()=>window.location.reload()}>Reload section</button></div>:content&&"data" in content&&gatheringView?<BriefScopePage key={`${record.id}-${section}`} initialData={content.data} view={gatheringView.view}/>:content&&"data" in content&&section==='designs'?<DesignsPage key={record.id} initialData={content.data} initialDesigns={content.designs} options={content.designOptions}/>:content&&'data' in content&&section==='site'&&content.site?<SitePage key={record.id} initialData={content.data} initialSite={content.site} initialItem={siteItem}/>:section === "overview" ? <>
      <div className={styles.caseSummary}><div><small>Customer</small><Link href={`/workspace/crm/customers?record=${record.customerId}`}>{record.customerName}<ArrowUpRight size={15} /></Link></div><div><small>Lead manager</small><strong>{record.leadManagerName ?? "Unassigned"}</strong></div><div><small>CRM opportunity</small><Link href={`/workspace/crm/opportunities?record=${record.opportunityId}`}>{record.opportunityStatus}<ArrowUpRight size={15} /></Link></div></div>
      {record.description ? <div className={styles.brief}><h2>Context from CRM</h2><p>{record.description}</p>{record.leadId ? <Link href={`/workspace/crm/leads?lead=${record.leadId}`}>View original lead <ArrowUpRight size={15} /></Link> : null}</div> : null}
      <h2 className={styles.sectionTitle}>Prepare, agree, then release</h2><p className={styles.hint}>Start with the client brief, organize room-by-room scope, then develop and review the design.</p>
      <div className={styles.steps}>{[
        { title: "Preparation", icon: ClipboardList, text: "Capture the brief, rooms and catalog-linked scope.", section: "requirements" },
        { title: "Designs", icon: Palette, text: "Upload design versions and record review decisions.", section: "designs" },
        { title: "Approvals & release", icon: ShieldCheck, text: "Record decisions before execution begins.", section: "approvals" },
      ].map((step) => <Link href={link(step.section)} key={step.title}><step.icon size={22} /><h3>{step.title}</h3><p>{step.text}</p><small>{step.section==="approvals"?"Section planned":"Open section"} <ArrowUpRight size={14} /></small></Link>)}</div>
      <p className={styles.hint}>Starting a case does not approve scope, create a contract, record payment or release an execution project.</p>
    </> : <div className={styles.planned}><span className={styles.badge}>Planned section</span><h2>{screen?.label} for this pre-execution</h2><p>This section is scoped to <strong>{record.title}</strong>. Its forms and approval workflows will be implemented section by section.</p><Link href={link("overview")}>Back to case overview</Link></div>}
  </section></DesignSystemProvider>;
}
