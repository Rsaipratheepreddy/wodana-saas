"use client";
import {useState} from 'react';
import {usePathname,useSearchParams} from 'next/navigation';
import Link from 'next/link';
import {Box,ClipboardList,KanbanSquare,Wallet,ArrowLeft} from 'lucide-react';
import {Button,MenuButton,DesignSystemProvider} from '@/design-system';
import type {ProjectState} from '@/lib/projects/execution';
import {useWorkspaceBreadcrumb} from '@/components/workspace/workspace-breadcrumb';
import {ProjectWorkspace} from './project-workspace';
import {ProjectPlanningPanel} from './project-planning-panel';
import {GlobalProjectWork} from './global-project-work';
import type {ProjectPlanningSection} from '@/lib/projects/planning';
import s from './project-connected-workspace.module.css';

const tabs=[{id:'items',label:'Items',icon:Box},{id:'planning',label:'Planning',icon:ClipboardList},{id:'work',label:'Work',icon:KanbanSquare},{id:'finance',label:'Finance',icon:Wallet}];
const planning=[{id:'requirements',label:'Requirements'},{id:'design',label:'Design'},{id:'quotations',label:'Quotations'},{id:'agreement',label:'Agreement & payment'},{id:'approvals',label:'Approvals'},{id:'change-requests',label:'Changes'}];
const tools=[{id:'approvals',label:'Approvals'},{id:'documents',label:'Drawings & documents'},{id:'teams',label:'Teams & bookings'},{id:'settings',label:'Project setup'},{id:'issues',label:'Issues & defects'},{id:'handover',label:'Handover & warranty'},{id:'updates',label:'Client updates'}];
const toolSections:Record<string,string>={approvals:'overview',documents:'documents',teams:'plan-teams',settings:'overview',issues:'snagging',handover:'handover',updates:'overview',tasks:'plan-teams'};
const toolViews:Record<string,string>={approvals:'approvals',teams:'teams',settings:'summary',updates:'client-updates'};
export function ProjectConnectedWorkspace({initial,projectName}:{initial:ProjectState;projectName:string}){
 useWorkspaceBreadcrumb(projectName);
 const [state,setState]=useState(initial);
 const path=usePathname(),params=useSearchParams();
 const raw=params.get('tab')??'items';
 const selected=tabs.some(tab=>tab.id===raw)?raw:raw==='execution'?'work':raw==='finance-expenses'?'finance':'items';
 const tool=params.get('tool')??'';
 const selectedPlanning=planning.some(tab=>tab.id===params.get('planningTab'))?params.get('planningTab')!:'requirements';
 function navigate(tab:string,tool='',planningTab?:string){
  const next=new URLSearchParams();next.set('tab',tab);next.set('projectName',projectName);
  if(tool){next.set('tool',tool);if(toolViews[tool])next.set('view',toolViews[tool]);}
  if(planningTab)next.set('planningTab',planningTab);
  window.history.pushState(null,'',`${path}?${next}`);
 }
 const embeddedSection=toolSections[tool]??(selected==='finance'?'commercial':'overview');
 return <DesignSystemProvider className={s.page}>
  <nav className={s.navigation} aria-label="Project sections">{tabs.map(tab=><Button key={tab.id} size="compact" variant={selected===tab.id&&!tool?'primary':'secondary'} aria-pressed={selected===tab.id&&!tool} onPress={()=>navigate(tab.id)}><tab.icon size={16}/>{tab.label}</Button>)}<div className={s.tools}><MenuButton label="Project tools" items={tools} onAction={key=>navigate(selected,String(key))}/></div></nav>
  {tool&&toolSections[tool]?<><div className={s.context}><Button size="compact" variant="quiet" onPress={()=>navigate('items')}><ArrowLeft size={14}/>Back to items</Button><strong>{tools.find(item=>item.id===tool)?.label??'Task configuration'}</strong></div><ProjectWorkspace key={`tool:${tool}`} connected initial={state} section={embeddedSection} onStateChange={setState}/></>:selected==='planning'?<><div className={s.subnav} role="group" aria-label="Planning sections">{planning.map(tab=><Button key={tab.id} size="compact" aria-pressed={selectedPlanning===tab.id} variant={selectedPlanning===tab.id?'primary':'secondary'} onPress={()=>navigate('planning','',tab.id)}>{tab.label}</Button>)}</div><ProjectPlanningPanel context={{workspaceId:state.workspaceId,caseId:state.caseId,projectId:state.id}} section={selectedPlanning as ProjectPlanningSection}/></>:selected==='work'?<><div className={s.context}><span>The same work queue, filtered to this project.</span><Button size="compact" onPress={()=>navigate('work','tasks')}>Configure tasks</Button><Link href="/workspace/tasks">Open global board ↗</Link></div><GlobalProjectWork workspaceId={state.workspaceId} initial={{rows:[],nextCursor:null,memberId:state.memberId}} fixedProjectId={state.id} resources={state.resources} embedded onProjectStateChange={setState}/></>:<ProjectWorkspace key={selected} connected initial={state} section={embeddedSection} onStateChange={setState}/>}
 </DesignSystemProvider>;
}
