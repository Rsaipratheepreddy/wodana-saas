"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, CircleCheck, ClipboardList, Clock3, Factory, FolderKanban, Handshake, PauseCircle, Plus } from "lucide-react";
import { Avatar, AvatarGroup, Button, Callout, ControlledModalDialog, DesignSystemProvider, SearchInput, SelectField } from "@/design-system";
import { identityVariant } from "@/lib/brand/identity";
import { projectDisplayName } from "@/lib/projects/format";
import type { PreProjectList, PreProjectListItem } from "@/lib/pre-project/types";
import { StartQualifiedLead } from "../pre-project/start-qualified-lead";
import type { PortfolioRow } from "./project-portfolio";
import styles from "./projects-board.module.css";

type Stage = "planning" | "production" | "handover" | "delivered";
export type ProjectCard = { id:string; title:string; description?:string | null; reference?:string; customer:string; stage:Stage; step:string; owner:string; team:string[]; href?:string; projectId?:string; caseId?:string; source?:PreProjectListItem; onHold:boolean; next?:string };
function ProjectName({title,opening=false}:{title:string;opening?:boolean}) {
  const name=projectDisplayName(title);
  return <><span className={styles.projectIcon} data-variant={identityVariant(title)}><FolderKanban aria-hidden="true" size={17}/></span><span className={styles.projectNameText}><span className={styles.projectNameTitle}>{opening ? "Opening…" : name || title}</span></span></>;
}
const stageDisplay = {
  planning: { label: "Planning", Icon: ClipboardList },
  production: { label: "Production", Icon: Factory },
  handover: { label: "Handover", Icon: Handshake },
  delivered: { label: "Delivered", Icon: CircleCheck },
} as const;
function StageChip({stage}:{stage:Stage}) {
  const {label,Icon}=stageDisplay[stage];
  return <span className={styles.stageChip} data-stage={stage}><Icon aria-hidden="true" size={15}/>{label}</span>;
}
function StatusChip({card}:{card:ProjectCard}) {
  const Icon=card.onHold ? PauseCircle : card.stage === "delivered" ? CircleCheck : card.stage === "handover" ? Clock3 : card.stage === "production" ? Activity : ClipboardList;
  return <span className={styles.statusChip} data-status={card.onHold ? "hold" : card.stage}><Icon aria-hidden="true" size={15}/>{card.onHold ? "On hold" : card.step}</span>;
}
const palmDeliveryStages = new Set(["procurement", "manufacturing_readiness", "factory_production", "site_works", "installation", "snagging", "client_handover", "completed"]);

export function projectCards(projects:PortfolioRow[], planning:PreProjectListItem[], palmFlowEnabled=false):ProjectCard[] {
  const linked = new Set(projects.map(project => project.caseId));
  const cards:ProjectCard[] = [
    ...planning.filter(item => !linked.has(item.id) && item.status !== "cancelled" && !palmFlowEnabled).map(item => ({id:`case-${item.id}`,title:item.title,customer:item.customerName,stage:"planning" as const,step:item.status === "qualified" ? "Ready for planning" : ({discover:"Requirements",define:"Scope confirmation",design:"Design",price:"Quotation",agree:"Agreement",release:"Ready for production"}[item.phase ?? "discover"]),owner:item.leadManagerName ?? "Unassigned",team:[],onHold:item.status === "on_hold" || ["lost","abandoned"].includes(item.opportunityStatus),source:item,...(!item.qualifiedLead ? {href:`/workspace/pre-projects/cases/${item.id}/requirements`} : {})})),
    ...projects.map(item => {
      const paidPalmPlanning = item.workflow?.templateCode === "palm_design_build_delivery" && !palmDeliveryStages.has(item.workflow.currentStageKey);
      return {id:`project-${item.id}`,projectId:item.id,caseId:item.caseId,title:item.name,reference:item.reference,customer:item.customer,stage:(item.phase === "completed" ? "delivered" : item.phase === "handover" ? "handover" : item.phase === "planning" || paidPalmPlanning ? "planning" : "production") as Stage,step:item.phase === "completed" ? "Complete" : item.phase === "handover" ? "Awaiting handover" : paidPalmPlanning ? item.workflow?.currentStageName ?? "Planning" : item.phase === "planning" ? "Execution planning" : "In progress",owner:item.manager ?? "Unassigned",team:item.team?.length ? item.team : item.manager ? item.manager.split(",").map(name=>name.trim()).filter(Boolean) : [],onHold:item.onHold,next:item.nextAction,href:`/workspace/projects/${item.id}/overview`};
    })
  ];
  const projectDescriptions=new Map(projects.map(item=>[item.id,item.description?.trim()]));
  const planningDescriptions=new Map(planning.map(item=>[item.id,item.description?.trim()]));
  return cards.map(card=>({...card,href:card.projectId ? `${card.href}?${new URLSearchParams({projectName:projectDisplayName(card.title)})}` : card.href,description:card.projectId ? projectDescriptions.get(card.projectId) || planningDescriptions.get(card.caseId ?? "") : card.source?.description?.trim()}));
}
export function ProjectsBoard({projects,planning,projectError,palmFlowEnabled=false}:{projects:PortfolioRow[];planning:PreProjectList;projectError?:string;palmFlowEnabled?:boolean}) {
  const router=useRouter(); const lock=useRef(false);
  const production=useSearchParams().get("view")==="production";
  const [search,setSearch]=useState(""); const [filter,setFilter]=useState("all"); const [busy,setBusy]=useState<string|null>(null); const [error,setError]=useState(""); const [lead,setLead]=useState<PreProjectListItem|null>(null);
  const [startOpen,setStartOpen]=useState(false),[candidates,setCandidates]=useState<Array<{id:string;title:string;customerName:string;status:string;caseId?:string|null}>>([]),[opportunityId,setOpportunityId]=useState(""),[candidateSearch,setCandidateSearch]=useState(""),[moreCandidates,setMoreCandidates]=useState(false),[loadingCandidates,setLoadingCandidates]=useState(false),[creating,setCreating]=useState(false),[startError,setStartError]=useState("");
  async function loadCandidates(search:string){
    if(!planning.canCreate)return;
    setLoadingCandidates(true);setStartError("");setOpportunityId("");
    try{
      const query=new URLSearchParams({workspaceId:planning.workspaceId});
      if(search.trim())query.set("search",search.trim());
      const response=await fetch(`/api/workspace/pre-projects/candidates?${query}`,{cache:"no-store",signal:AbortSignal.timeout(15000)});
      const payload=await response.json();
      if(!response.ok)throw Error(payload.message??"Eligible opportunities could not be loaded.");
      if(!Array.isArray(payload.items))throw Error("The opportunity list could not be read. Refresh and try again.");
      setCandidates(payload.items.filter((item:{caseId?:string|null})=>!item.caseId));
      setMoreCandidates(payload.hasMore===true);
    }
    catch(cause){setCandidates([]);setMoreCandidates(false);setStartError(cause instanceof Error?cause.message:"Eligible opportunities could not be loaded.");}
    finally{setLoadingCandidates(false);}
  }
  async function startPlanning(){
    setStartOpen(true);setStartError("");setOpportunityId("");setCandidateSearch("");setCandidates([]);setMoreCandidates(false);
    await loadCandidates("");
  }
  async function createPlanning(){
    if(!opportunityId||creating||!planning.canCreate)return;
    setCreating(true);setStartError("");
    try{const response=await fetch(`/api/workspace/pre-projects?workspaceId=${encodeURIComponent(planning.workspaceId)}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({opportunityId}),signal:AbortSignal.timeout(20000)});const payload=await response.json();if(!response.ok)throw Error(payload.message??"Planning could not be started.");if(!payload.id)throw Error("The new planning record could not be confirmed. Refresh Projects before retrying.");router.push(`/workspace/pre-projects/cases/${encodeURIComponent(payload.id)}/requirements`);}
    catch(cause){setStartError(cause instanceof Error?cause.message:"Planning could not be started.");setCreating(false);}
  }
  const cards=projectCards(projects,planning.items,palmFlowEnabled).filter(item=>(production ? item.stage!=="planning" : item.stage==="planning") && (filter==="all" || (filter==="hold" ? item.onHold : !item.onHold)) && `${item.title} ${item.customer} ${item.owner}`.toLowerCase().includes(search.toLowerCase()));
  async function open(card:ProjectCard) {
    if(card.href){router.push(card.href);return;}
    if(lock.current || !card.source)return;
    if(!card.source.opportunityId){setLead(card.source);return;}
    lock.current=true;setBusy(card.id);setError("");
    try { const response=await fetch(`/api/workspace/pre-projects?workspaceId=${planning.workspaceId}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({opportunityId:card.source.opportunityId}),signal:AbortSignal.timeout(20000)}); const result=await response.json(); if(!response.ok)throw Error(result.message ?? "Could not open planning.");router.push(`/workspace/pre-projects/cases/${result.id}/requirements`); }
    catch(cause){setError(cause instanceof Error?cause.message:"Could not open planning.");}
    finally{lock.current=false;setBusy(null);}
  }
  return <DesignSystemProvider className={styles.provider}><section className={styles.page} aria-label="Projects">
    <div className={styles.toolbar}><SearchInput label="Search projects" placeholder="Search projects or clients" value={search} onChange={setSearch}/><SelectField label={null} aria-label="Project status" selectedKey={filter} onSelectionChange={key=>setFilter(String(key))} items={[{id:"all",label:"All projects"},{id:"active",label:"Active"},{id:"hold",label:"On hold"}]}/><Button size="compact" onPress={()=>router.refresh()}>Refresh</Button>{!production&&(palmFlowEnabled ? <Link className="wd-button" data-size="compact" href="/workspace/crm/preparation">Open Sales preparation</Link> : <Button size="compact" variant="primary" onPress={()=>void startPlanning()}><Plus size={14} aria-hidden="true"/>Start project</Button>)}</div>
    {(error || projectError || planning.error) && <Callout tone="warning" title="Some projects could not be loaded">{error || projectError || planning.error}</Callout>}
    <div className={`${styles.tableFrame} ${styles.clientTableFrame}`}><table className={`${styles.projectTable} ${styles.clientProjectTable}`} aria-label="Client projects"><thead><tr><th scope="col">Project</th><th scope="col">Client</th><th scope="col">Owner</th><th scope="col">Teams</th><th scope="col">Stage</th><th scope="col">Status</th></tr></thead><tbody>{cards.map(card=><tr key={card.id}>
      <th scope="row"><strong>{card.href ? <Link aria-label={card.title} className={styles.projectNameLink} href={!production && card.caseId && !palmFlowEnabled ? `/workspace/pre-projects/cases/${card.caseId}/requirements` : card.href}><ProjectName title={card.title}/></Link> : <button aria-label={busy===card.id ? "Opening…" : card.title} type="button" className={styles.projectNameButton} disabled={Boolean(busy) || !(card.source?.opportunityId ? planning.canCreate : planning.canStartLead)} onClick={()=>void open(card)}><ProjectName title={card.title} opening={busy===card.id}/></button>}</strong>{card.reference && <span className={styles.projectReference}>{card.reference}</span>}{card.description && <p className={styles.projectDescription} title={card.description}>{card.description}</p>}{card.projectId && <div className={styles.destinations} aria-label={`Open ${projectDisplayName(card.title)}`}>{card.caseId && <Link href={`/workspace/pre-projects/cases/${card.caseId}/requirements`}><ClipboardList size={13} aria-hidden="true"/>{palmFlowEnabled ? "Sales file" : "Planning"}</Link>}<Link href={`/workspace/projects/${card.projectId}/overview`}><Factory size={13} aria-hidden="true"/>{palmFlowEnabled ? "Project" : "Production"}</Link></div>}</th>
      <td>{card.customer}</td>
      <td>{card.owner === "Unassigned" ? <span className={styles.muted}>Unassigned</span> : <span className={styles.ownerCell}><Avatar name={card.owner} size="sm" colorVariant={identityVariant(card.owner)}/><span>{card.owner}</span></span>}</td>
      <td>{card.team.length ? <span className={styles.teamCell} title={card.team.join(", ")}><AvatarGroup label={`Team for ${card.title}`}>{card.team.slice(0,3).map((name,index)=><Avatar key={name} name={name} size="sm" colorVariant={identityVariant(name)+1+index}/>)}</AvatarGroup><span>{card.team.length===1 ? card.team[0] : `${card.team.length} members`}</span></span> : <span className={styles.muted}>Not assigned</span>}</td>
      <td><StageChip stage={card.stage}/></td>
      <td><StatusChip card={card}/></td>
    </tr>)}</tbody></table><div className={styles.tableFooter}>{cards.length} {cards.length===1?"project":"projects"}</div></div>
    {!cards.length && <div className={styles.empty}><strong>No matching {production ? "production projects" : palmFlowEnabled ? "planning projects" : "planning cases"}</strong><p>{search ? "Try another client or project name." : production ? "Projects released to delivery appear here for production, site work and handover." : palmFlowEnabled ? "A project appears here after the first paid Deal File is approved. Before payment, continue in Sales preparation." : "Projects still in planning appear here. Released projects are under Production."}</p></div>}
    {lead && <StartQualifiedLead workspaceId={planning.workspaceId} lead={lead} onClose={()=>setLead(null)} onStarted={id=>router.push(`/workspace/pre-projects/cases/${id}/requirements`)}/>}
    <ControlledModalDialog isOpen={startOpen} onOpenChange={open=>!creating&&setStartOpen(open)} title="Start project planning" footer={<><Button isDisabled={creating} onPress={()=>setStartOpen(false)}>Cancel</Button>{planning.canCreate&&<Button variant="primary" isDisabled={!opportunityId||loadingCandidates||creating} isLoading={creating} onPress={()=>void createPlanning()}>Start with requirements</Button>}</>}>
      <p>Choose an open or won opportunity. Requirements come first; production is released only after the required approvals.</p>
      {startError&&<Callout tone="warning" title="Could not start planning">{startError}</Callout>}
      {planning.error?<Callout tone="warning" title="Planning access could not be checked">{planning.error}</Callout>:!planning.canCreate?<Callout tone="warning" title="Project creation needs access">Your account needs Pre-execution create and Opportunities view permissions. Ask your workspace administrator to update your role.</Callout>:<><div className={styles.candidateSearch}><SearchInput label="Search opportunities" placeholder="Find by project or client" value={candidateSearch} onChange={setCandidateSearch}/><Button size="compact" isDisabled={loadingCandidates} onPress={()=>void loadCandidates(candidateSearch)}>Find</Button></div>{loadingCandidates?<p role="status">Loading opportunities…</p>:candidates.length?<><SelectField label="Opportunity" isRequired items={candidates.map(item=>({id:item.id,label:`${item.title} · ${item.customerName}`}))} selectedKey={opportunityId||null} onSelectionChange={key=>setOpportunityId(String(key??""))} placeholder="Choose an opportunity"/>{moreCandidates&&<p className={styles.candidateHint}>More opportunities exist. Search by project or client to find one beyond this list.</p>}</>:!startError?<p>No eligible opportunities found. Try another search, or start with an enquiry in Sales and qualify it.</p>:null}</>}
      <div className={styles.startLinks}><Link href="/workspace/crm/leads?create=true">New enquiry</Link><Link href="/workspace/crm/opportunities">View opportunities</Link></div>
    </ControlledModalDialog>
  </section></DesignSystemProvider>;
}
