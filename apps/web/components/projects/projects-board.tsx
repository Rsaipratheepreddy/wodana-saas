"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown } from "@/lib/i18n/keys";
import { DEAL_FIRST_WORKFLOW_CODE } from "../../../../services/business-core/src/projects/deal-first-workflow";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, CircleCheck, ClipboardList, Clock3, Factory, FolderKanban, Handshake, PauseCircle, Plus } from "lucide-react";
import { Avatar, AvatarGroup, Button, Callout, ControlledModalDialog, DesignSystemProvider, EmptyState, personDisplayName, SearchInput, SegmentedControl, SelectField } from "@/design-system";
import { identityVariant } from "@/lib/brand/identity";
import { projectDisplayName } from "@/lib/projects/format";
import type { PreProjectList, PreProjectListItem } from "@/lib/pre-project/types";
import { StartQualifiedLead } from "../pre-project/start-qualified-lead";
import type { PortfolioRow } from "./project-portfolio";
import styles from "./projects-board.module.css";

type Stage = "planning" | "production" | "handover" | "delivered";
export type PlanningGroup = "ready" | "before_deal" | "in_design";
export type ProjectCard = { group?:PlanningGroup; id:string; title:string; description?:string | null; reference?:string; customer:string; stage:Stage; step:string; owner:string; team:string[]; href?:string; projectId?:string; caseId?:string; source?:PreProjectListItem; onHold:boolean; next?:string };
function ProjectName({title,opening=false}:{title:string;opening?:boolean}) {
  const t = useT();
  const name=projectDisplayName(title);
  return <><span className={styles.projectIcon} data-variant={identityVariant(title)}><FolderKanban aria-hidden="true" size={17}/></span><span className={styles.projectNameText}><span className={styles.projectNameTitle}>{opening ? t("Opening…") : name || title}</span></span></>;
}
const stageDisplay = {
  planning: { label: tKey("Planning"), Icon: ClipboardList },
  production: { label: tKey("Production"), Icon: Factory },
  handover: { label: tKey("Handover"), Icon: Handshake },
  delivered: { label: tKey("Delivered"), Icon: CircleCheck },
} as const;
function StageChip({stage}:{stage:Stage}) {
  const t = useT();
  const {label,Icon}=stageDisplay[stage];
  return <span className={styles.stageChip} data-stage={stage}><Icon aria-hidden="true" size={15}/>{t(label)}</span>;
}
function StatusChip({card}:{card:ProjectCard}) {
  const t = useT();
  const Icon=card.onHold ? PauseCircle : card.stage === "delivered" ? CircleCheck : card.stage === "handover" ? Clock3 : card.stage === "production" ? Activity : ClipboardList;
  return <span className={styles.statusChip} data-status={card.onHold ? "hold" : card.stage}><Icon aria-hidden="true" size={15}/>{card.onHold ? t("On hold") : translateKnown(t, card.step)}</span>;
}
const palmDeliveryStages = new Set(["procurement", "manufacturing_readiness", "factory_production", "site_works", "installation", "snagging", "client_handover", "completed"]);

export function projectCards(projects:PortfolioRow[], planning:PreProjectListItem[], palmFlowEnabled=false):ProjectCard[] {
  const linked = new Set(projects.map(project => project.caseId));
  const cards:ProjectCard[] = [
    ...planning.filter(item => !linked.has(item.id) && item.status !== "cancelled").map(item => ({id:`case-${item.id}`,title:item.title,customer:item.customerName,stage:"planning" as const,group:(item.qualifiedLead || item.status === "qualified" ? "ready" : "before_deal") as PlanningGroup,step:item.status === "qualified" ? tKey("Ready to start") : palmFlowEnabled ? tKey("Before deal") : ({discover:tKey("Requirements"),define:tKey("Scope confirmation"),design:tKey("Design"),price:tKey("Quotation"),agree:tKey("Agreement"),release:tKey("Ready for production")}[item.phase ?? "discover"]),owner:personDisplayName(item.leadManagerName) || "Unassigned",team:[],onHold:item.status === "on_hold" || ["lost","abandoned"].includes(item.opportunityStatus),source:item,...(!item.qualifiedLead ? {href:`/workspace/pre-projects/cases/${item.id}/requirements`} : {})})),
    ...projects.map(item => {
      const paidPalmPlanning = item.workflow?.templateCode === DEAL_FIRST_WORKFLOW_CODE && !palmDeliveryStages.has(item.workflow.currentStageKey);
      return {id:`project-${item.id}`,projectId:item.id,caseId:item.caseId,group:"in_design" as PlanningGroup,title:item.name,reference:item.reference,customer:item.customer,stage:(item.phase === "completed" ? "delivered" : item.phase === "handover" ? "handover" : item.phase === "planning" || paidPalmPlanning ? "planning" : "production") as Stage,step:item.phase === "completed" ? tKey("Complete") : item.phase === "handover" ? tKey("Awaiting handover") : paidPalmPlanning ? item.workflow?.currentStageName ?? tKey("Planning") : item.phase === "planning" ? tKey("Execution planning") : tKey("In progress"),owner:personDisplayName(item.manager) || "Unassigned",team:item.team?.length ? item.team : item.manager ? item.manager.split(",").map(name=>name.trim()).filter(Boolean) : [],onHold:item.onHold,next:item.nextAction,href:`/workspace/projects/${item.id}/overview`};
    })
  ];
  const projectDescriptions=new Map(projects.map(item=>[item.id,item.description?.trim()]));
  const planningDescriptions=new Map(planning.map(item=>[item.id,item.description?.trim()]));
  return cards.map(card=>({...card,href:card.projectId ? `${card.href}?${new URLSearchParams({projectName:projectDisplayName(card.title)})}` : card.href,description:card.projectId ? projectDescriptions.get(card.projectId) || planningDescriptions.get(card.caseId ?? "") : card.source?.description?.trim()}));
}
/** One board, two places: Planning (cases being briefed, designed and priced) and Projects (released work). */
export function ProjectsBoard({projects,planning,projectError,palmFlowEnabled=false,mode="projects",initialGroup}:{projects:PortfolioRow[];planning:PreProjectList;projectError?:string;palmFlowEnabled?:boolean;mode?:"planning"|"projects";initialGroup?:PlanningGroup}) {
  const t = useT();
  const router=useRouter(); const lock=useRef(false);
  const production=mode==="projects";
  const [search,setSearch]=useState(""); const [filter,setFilter]=useState("all"); const [group,setGroup]=useState<"all"|PlanningGroup>(initialGroup ?? "all"); const [busy,setBusy]=useState<string|null>(null); const [error,setError]=useState(""); const [lead,setLead]=useState<PreProjectListItem|null>(null);
  const [startOpen,setStartOpen]=useState(false),[candidates,setCandidates]=useState<Array<{id:string;title:string;customerName:string;status:string;caseId?:string|null}>>([]),[opportunityId,setOpportunityId]=useState(""),[candidateSearch,setCandidateSearch]=useState(""),[moreCandidates,setMoreCandidates]=useState(false),[loadingCandidates,setLoadingCandidates]=useState(false),[creating,setCreating]=useState(false),[startError,setStartError]=useState("");
  async function loadCandidates(search:string){
    if(!planning.canCreate)return;
    setLoadingCandidates(true);setStartError("");setOpportunityId("");
    try{
      const query=new URLSearchParams({workspaceId:planning.workspaceId});
      if(search.trim())query.set("search",search.trim());
      const response=await fetch(`/api/workspace/pre-projects/candidates?${query}`,{cache:"no-store",signal:AbortSignal.timeout(15000)});
      const payload=await response.json();
      if(!response.ok)throw Error(payload.message??t("Eligible opportunities could not be loaded."));
      if(!Array.isArray(payload.items))throw Error(t("The opportunity list could not be read. Refresh and try again."));
      setCandidates(payload.items.filter((item:{caseId?:string|null})=>!item.caseId));
      setMoreCandidates(payload.hasMore===true);
    }
    catch(cause){setCandidates([]);setMoreCandidates(false);setStartError(cause instanceof Error?cause.message:t("Eligible opportunities could not be loaded."));}
    finally{setLoadingCandidates(false);}
  }
  async function startPlanning(){
    setStartOpen(true);setStartError("");setOpportunityId("");setCandidateSearch("");setCandidates([]);setMoreCandidates(false);
    await loadCandidates("");
  }
  async function createPlanning(){
    if(!opportunityId||creating||!planning.canCreate)return;
    setCreating(true);setStartError("");
    try{const response=await fetch(`/api/workspace/pre-projects?workspaceId=${encodeURIComponent(planning.workspaceId)}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({opportunityId}),signal:AbortSignal.timeout(20000)});const payload=await response.json();if(!response.ok)throw Error(payload.message??t("Planning could not be started."));if(!payload.id)throw Error(t("The new planning record could not be confirmed. Refresh Projects before retrying."));router.push(`/workspace/pre-projects/cases/${encodeURIComponent(payload.id)}/overview`);}
    catch(cause){setStartError(cause instanceof Error?cause.message:t("Planning could not be started."));setCreating(false);}
  }
  const cards=projectCards(projects,planning.items,palmFlowEnabled).filter(item=>(production ? item.stage!=="planning" : item.stage==="planning") && (production || group==="all" || item.group===group) && (filter==="all" || (filter==="hold" ? item.onHold : !item.onHold)) && `${item.title} ${item.customer} ${item.owner}`.toLowerCase().includes(search.toLowerCase()));
  async function open(card:ProjectCard) {
    if(card.href){router.push(card.href);return;}
    if(lock.current || !card.source)return;
    if(!card.source.opportunityId){setLead(card.source);return;}
    lock.current=true;setBusy(card.id);setError("");
    try { const response=await fetch(`/api/workspace/pre-projects?workspaceId=${planning.workspaceId}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({opportunityId:card.source.opportunityId}),signal:AbortSignal.timeout(20000)}); const result=await response.json(); if(!response.ok)throw Error(result.message ?? t("Could not open planning."));router.push(`/workspace/pre-projects/cases/${result.id}/requirements`); }
    catch(cause){setError(cause instanceof Error?cause.message:t("Could not open planning."));}
    finally{lock.current=false;setBusy(null);}
  }
  return <DesignSystemProvider className={styles.provider}><section className={styles.page} aria-label={production ? t("Projects") : t("Planning")}>
    <div className={styles.toolbar}><SearchInput label={t("Search projects")} placeholder={t("Search projects or clients")} value={search} onChange={setSearch}/><SelectField label={null} aria-label={t("Project status")} selectedKey={filter} onSelectionChange={key=>setFilter(String(key))} items={[{id:"all",label:t("All projects")},{id:"active",label:t("Active")},{id:"hold",label:t("On hold")}]}/>{!production&&<SegmentedControl label={t("Planning stage")} value={group} onChange={value=>setGroup(value as "all"|PlanningGroup)} options={[{id:"all",label:t("All")},{id:"ready",label:t("Ready to start")},{id:"before_deal",label:palmFlowEnabled?t("Before deal"):t("In planning")},{id:"in_design",label:palmFlowEnabled?t("In design"):t("Project open")}]}/>}<span className={styles.toolbarSpacer}/>{!production&&<Button size="compact" variant="primary" onPress={()=>void startPlanning()}><Plus size={14} aria-hidden="true"/>{t("Start planning")}</Button>}</div>
    {(error || projectError || planning.error) && <Callout tone="warning" title={t("Some projects could not be loaded")}>{translateKnown(t, error || projectError || planning.error || "")}</Callout>}
    {cards.length > 0 && <div data-record-table-scroll className={`${styles.tableFrame} ${styles.clientTableFrame}`}><table data-record-table className={`wd-record-table ${styles.projectTable} ${styles.clientProjectTable}`} aria-label={t("Client projects")}><thead><tr><th scope="col">{t("Project")}</th><th scope="col">{t("Client")}</th><th scope="col">{t("Owner")}</th><th scope="col">{t("Teams")}</th><th scope="col">{t("Stage")}</th><th scope="col">{t("Status")}</th></tr></thead><tbody>{cards.map(card=><tr key={card.id}>
      <th scope="row"><strong>{card.href ? <Link aria-label={card.title} className={styles.projectNameLink} href={!production && card.caseId && !palmFlowEnabled ? `/workspace/pre-projects/cases/${card.caseId}/overview` : card.href}><ProjectName title={card.title}/></Link> : <button aria-label={busy===card.id ? t("Opening…") : card.title} type="button" className={styles.projectNameButton} disabled={Boolean(busy) || !(card.source?.opportunityId ? planning.canCreate : planning.canStartLead)} onClick={()=>void open(card)}><ProjectName title={card.title} opening={busy===card.id}/></button>}</strong>{card.reference && <span className={styles.projectReference}>{card.reference}</span>}{card.description && <p className={styles.projectDescription} title={card.description}>{card.description}</p>}{card.projectId && <div className={styles.destinations} aria-label={t("Open {name}", { name: projectDisplayName(card.title) })}>{card.caseId && <Link href={`/workspace/pre-projects/cases/${card.caseId}/overview`}><ClipboardList size={13} aria-hidden="true"/>{palmFlowEnabled ? t("Sales file") : t("Planning")}</Link>}<Link href={`/workspace/projects/${card.projectId}/overview`}><Factory size={13} aria-hidden="true"/>{palmFlowEnabled ? t("Project") : t("Production")}</Link></div>}</th>
      <td>{card.customer}</td>
      <td>{card.owner === "Unassigned" ? <span className={styles.muted}>{t("Unassigned")}</span> : <span className={styles.ownerCell}><Avatar name={card.owner} size="sm" colorVariant={identityVariant(card.owner)}/><span>{card.owner}</span></span>}</td>
      <td>{card.team.length ? <span className={styles.teamCell} title={card.team.join(", ")}><AvatarGroup label={t("Team for {title}", { title: card.title })}>{card.team.slice(0,3).map((name,index)=><Avatar key={name} name={name} size="sm" colorVariant={identityVariant(name)+1+index}/>)}</AvatarGroup><span>{card.team.length===1 ? card.team[0] : t("{count} members", { count: card.team.length })}</span></span> : <span className={styles.muted}>{t("Not assigned")}</span>}</td>
      <td><StageChip stage={card.stage}/></td>
      <td><StatusChip card={card}/></td>
    </tr>)}</tbody></table></div>}{cards.length > 0 && <p className={styles.tableFooter}>{cards.length===1 ? t("1 project") : t("{count} projects", { count: cards.length })}</p>}
    {!cards.length && <EmptyState illustration={search ? "search" : "empty"} title={search ? t("Nothing matches this search") : production ? t("No projects yet") : t("Nothing in planning yet")} description={search ? t("Try another client or project name.") : production ? t("Projects appear here once their planning is released to delivery.") : palmFlowEnabled ? t("A project appears here after the first paid Deal File is approved.") : t("Qualified opportunities appear here, ready to plan.")} />}
    {lead && <StartQualifiedLead workspaceId={planning.workspaceId} lead={lead} onClose={()=>setLead(null)} onStarted={id=>router.push(`/workspace/pre-projects/cases/${id}/requirements`)}/>}
    <ControlledModalDialog isOpen={startOpen} onOpenChange={open=>!creating&&setStartOpen(open)} title={t("Start planning")} footer={<><Button isDisabled={creating} onPress={()=>setStartOpen(false)}>{t("Cancel")}</Button>{planning.canCreate&&<Button variant="primary" isDisabled={!opportunityId||loadingCandidates||creating} isLoading={creating} onPress={()=>void createPlanning()}>{t("Start with requirements")}</Button>}</>}>
      <p>{t("Choose an open or won opportunity. Requirements come first; production is released only after the required approvals.")}</p>
      {startError&&<Callout tone="warning" title={t("Could not start planning")}>{startError}</Callout>}
      {planning.error?<Callout tone="warning" title={t("Planning access could not be checked")}>{translateKnown(t, planning.error)}</Callout>:!planning.canCreate?<Callout tone="warning" title={t("Project creation needs access")}>{t("Your account needs Planning create and Opportunities view permissions. Ask your workspace administrator to update your role.")}</Callout>:<><div className={styles.candidateSearch}><SearchInput label={t("Search opportunities")} placeholder={t("Find by project or client")} value={candidateSearch} onChange={setCandidateSearch}/><Button size="compact" isDisabled={loadingCandidates} onPress={()=>void loadCandidates(candidateSearch)}>{t("Find")}</Button></div>{loadingCandidates?<p role="status">{t("Loading opportunities…")}</p>:candidates.length?<><SelectField label={t("Opportunity")} isRequired items={candidates.map(item=>({id:item.id,label:`${item.title} · ${item.customerName}`}))} selectedKey={opportunityId||null} onSelectionChange={key=>setOpportunityId(String(key??""))} placeholder={t("Choose an opportunity")}/>{moreCandidates&&<p className={styles.candidateHint}>{t("More opportunities exist. Search by project or client to find one beyond this list.")}</p>}</>:!startError?<p>{t("No eligible opportunities found. Try another search, or start with an enquiry in Sales and qualify it.")}</p>:null}</>}
      <div className={styles.startLinks}><Link href="/workspace/crm/leads?create=true">{t("New enquiry")}</Link><Link href="/workspace/crm/opportunities">{t("View opportunities")}</Link></div>
    </ControlledModalDialog>
  </section></DesignSystemProvider>;
}
