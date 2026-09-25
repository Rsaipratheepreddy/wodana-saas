"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Building2, Check, ChevronRight, FileText, Globe2, Import, Plug, Users, X } from "lucide-react";
import { Button, ControlledModalDialog } from "@/design-system";
import s from "./workspace-readiness.module.css";

export type ReadinessData = { company: boolean | null; regional: boolean | null; people: boolean | null; connections: boolean | null };
export function WorkspaceReadiness({ workspaceId, userId, readiness, modules, compact = false }: { compact?: boolean; workspaceId:string; userId:string; readiness?:ReadinessData; modules:string[] }) {
  const [hidden,setHidden]=useState(false);
  const [open,setOpen]=useState(false);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => { setOpen(false); setImports(false); }, [pathname]);
  const [imports,setImports]=useState(false);
  const key=`wodana:readiness:${workspaceId}:${userId}`;
  useEffect(()=>{try {setHidden(localStorage.getItem(key)==="hidden");}catch {}},[key]);
  const toggle=(value:boolean)=>{setHidden(value);try {localStorage.setItem(key,value?"hidden":"visible");}catch {}};
  const steps=[
    {id:"company",label:"Company details",description:"Make your documents yours.",detail:"Review your company name, address and branding before preparing client documents.",href:"/workspace/company",action:"Review company",Icon:Building2,done:readiness?.company},
    {id:"regional",label:"Regional defaults",description:"Consistent dates, prices and units.",detail:"Your currency, time zone and measurements carry into records across the workspace.",href:"/workspace/company",action:"Review defaults",Icon:Globe2,done:readiness?.regional},
    {id:"people",label:"People & roles",description:"Give everyone the right access.",detail:"Check your available seats and invite teammates with the role they need.",href:"/workspace/members",action:"Manage people",Icon:Users,done:readiness?.people,optional:true},
    ...(modules.includes("crm")||modules.includes("pre-project")?[{id:"data",label:"Bring your data",description:"Start with the records you already have.",detail:"Bring existing contacts and catalog sheets into one workspace. Review your data before anything is added.",href:"",action:"Choose data",Icon:Import,done:false,optional:true}]:[]),
    ...(modules.includes("pre-project")?[{id:"quotations",label:"Quotation templates",description:"Prepare a consistent starting point.",detail:"Set up reusable quotation content, rates and terms before building your first proposal.",href:"/workspace/pre-projects/quotation-templates",action:"Open templates",Icon:FileText,done:false,optional:true}]:[]),
    {id:"connections",label:"Connect your tools",description:"Keep conversations and accounts together.",detail:"Connect Google Workspace, WhatsApp or your accounting provider. Each account is authorized separately.",href:"/workspace/integrations",action:"View connections",Icon:Plug,done:readiness?.connections,optional:true},
  ];
  const completed=steps.filter(step=>step.done===true).length;
  if(hidden && !compact)return <div className={s.restore}><Button variant="quiet" size="compact" onPress={()=>toggle(false)}><Check size={14}/>Workspace setup<span>{completed}/{steps.length}</span><ChevronRight size={14}/></Button></div>;
  const checklist = <section className={s.readiness} aria-label="Workspace readiness">
    {!compact && <header className={s.header}><div><h2>Set up your workspace</h2></div><div className={s.controls}><span className={s.count}>{completed}/{steps.length}</span><Button variant="quiet" size="compact" aria-label="Hide workspace setup" onPress={()=>toggle(true)}><X size={16}/></Button></div></header>}
    <div className={s.steps} aria-label="Setup tasks">{steps.map(step => <div key={step.id} className={s.taskRow} data-complete={step.done===true}>
      <span className={s.checkbox} data-done={step.done===true} aria-hidden="true">{step.done===true&&<Check size={12} strokeWidth={3}/>}</span>
      <span className={s.taskLabel}>{step.label}<small>{step.description}</small></span><span className={s.stepArt} aria-hidden="true"><step.Icon size={28} strokeWidth={1.6}/></span>
      {step.done!==true && (step.id==="data" ? <Button size="compact" onPress={()=>setImports(true)}>Choose data<ArrowRight size={14}/></Button> : <Link className={s.rowAction} href={step.href}>{step.action}<ArrowRight size={14}/></Link>)}
    </div>)}</div>
    <ControlledModalDialog isOpen={imports} onOpenChange={setImports} title="Bring your data" description="Choose what you want to add to your workspace." size="md">
      <div className={s.importOptions}>{modules.includes("pre-project")&&<Link href="/workspace/catalogs"><span className={s.icon}><Import size={18}/></span><span><strong>Materials & catalog</strong><small>Use Import in Catalog to upload and review your sheet.</small></span><ArrowRight size={16}/></Link>}{modules.includes("crm")&&<div><span className={s.icon}><Users size={18}/></span><span><strong>Clients & contacts</strong><small>Bulk import is being built. You can add clients individually now.</small><Link href="/workspace/crm/customers">Open clients<ArrowRight size={13}/></Link></span><span className={s.tag}>Next</span></div>}</div>
    </ControlledModalDialog>
  </section>;
  if (!compact) return checklist;
  return <><button type="button" className={s.setupCard} onClick={() => { router.refresh(); setOpen(true); }} aria-label={`Set up your workspace, ${completed} of ${steps.length} complete`}><span>Set up your workspace</span><small>{completed}/{steps.length}</small><progress max={steps.length} value={completed} /></button><ControlledModalDialog isOpen={open} onOpenChange={setOpen} title="Set up your workspace" description={`${completed} of ${steps.length} complete`} size="lg">{checklist}</ControlledModalDialog></>;
}
