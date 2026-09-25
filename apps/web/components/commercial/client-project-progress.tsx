"use client";
import {useState, type ReactNode} from "react";
import {Button, ControlledModalDialog, DataGrid, SegmentedControl, SelectField, type DataGridColumn} from "@/design-system";
import type {PublicProject} from "@/lib/projects/execution";
import p from "./client-portal.module.css";
const label=(value:string)=>value.replaceAll("_"," ");
type Work=NonNullable<PublicProject['tasks']>[number];
type Report=PublicProject['reports'][number];
export function ClientProjectProgress({project,slug,handover,onRefresh}:{project:PublicProject;slug:string;handover:ReactNode;onRefresh:()=>void}) {
 const [selectedView,setView]=useState("overview"),[area,setArea]=useState("all");
 const [reportId,setReportId]=useState<string|null>(null),[taskId,setTaskId]=useState<string|null>(null);
 const sections={progress:true,documents:true,handover:true,updates:true,...project.clientSections};
 const options=[...(sections.progress?[{id:'overview',label:'Overview'},{id:'work',label:'Work progress'},{id:'daily',label:'Daily updates'}]:[]),...(sections.updates?[{id:'updates',label:'Updates'}]:[]),...(sections.documents?[{id:'files',label:'Documents'}]:[]),...(sections.handover?[{id:'handover',label:'Handover'}]:[])];
 const view=options.some(option=>option.id===selectedView)?selectedView:options[0]?.id;
 const reports=sections.progress?project.reports.slice().sort((a,b)=>b.date.localeCompare(a.date)):[];
 const report=reports.find(r=>r.id===reportId),task=sections.progress?project.tasks?.find(t=>t.id===taskId):undefined;
 const updates=sections.updates?(project.clientUpdates??[]).filter(update=>update.status==='published').slice().sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)):[];
 const tasks=(project.tasks??[]).filter(t=>area==='all'||t.area===area);
 const areas=[...new Set((project.tasks??[]).map(t=>t.area).filter(Boolean))];
 const empty=(text:string)=><p className={p.muted}>{text}</p>;
 const workColumns:DataGridColumn<Work>[]=[
  {id:'title',header:'Item / task',accessorFn:t=>t.title,meta:{primary:true}},
  {id:'area',header:'Room / area',accessorFn:t=>t.area||'—'},
  {id:'location',header:'Location',accessorFn:t=>t.location==='factory'?'Factory':t.location==='site'?'On-site':label(t.location)},
  {id:'quantity',header:'Shared progress',accessorFn:t=>t.reportedQuantity,meta:{renderCell:t=>`${t.reportedQuantity} / ${t.quantity} ${t.unit}`}},
  {id:'status',header:'Status',accessorFn:t=>label(t.status)},
  {id:'action',header:'',enableSorting:false,meta:{renderCell:t=><Button size="compact" onPress={()=>setTaskId(t.id)}>View work</Button>}},
 ];
 const reportColumns:DataGridColumn<Report>[]=[
  {id:'date',header:'Date',accessorFn:r=>r.date,meta:{primary:true}},
  {id:'location',header:'Location',accessorFn:r=>r.location==='factory'?'Factory':'On-site'},
  {id:'summary',header:'Update',accessorFn:r=>r.clientSummary||`${r.work.length} work items updated`},
  {id:'files',header:'Files',accessorFn:r=>r.files?.length??0},
  {id:'action',header:'',enableSorting:false,meta:{renderCell:r=><Button size="compact" onPress={()=>setReportId(r.id)}>View update</Button>}},
 ];
 return <>
  <div className={p.actions}>{options.length>0&&<SegmentedControl label="Project views" value={view} onChange={setView} options={options}/>}<Button size="compact" onPress={onRefresh}>Refresh</Button></div>
  {!options.length&&empty('Your team has not enabled any project sections yet.')}
  {view==='updates'&&<section aria-label="Published project updates">{updates.length?updates.map(update=><article className={p.section} key={update.id}><div className={p.title}><h3>{update.title}</h3><span className={p.status} data-status="published">{label(update.kind)}</span></div><p style={{whiteSpace:'pre-wrap'}}>{update.summary}</p><time className={p.muted} dateTime={update.publishedAt}>{new Date(update.publishedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</time></article>):empty('No project updates have been shared yet.')}</section>}
  {view==='overview'&&<>
   <section className={p.projectSummary}><div><span className={p.status}>{project.stage?.name||label(project.phase)}</span><h2>{project.name}</h2>{project.promise&&<p>{project.promise}</p>}</div><div className={p.projectProgress}><strong>{project.progress}%</strong><span>approved progress</span><i><b style={{inlineSize:`${Math.max(0,Math.min(100,project.progress))}%`}}/></i></div><dl><div><dt>Target completion</dt><dd>{project.targetCompletion||'To be confirmed'}</dd></div><div><dt>Handover</dt><dd>{project.handoverDate||'To be confirmed'}</dd></div></dl></section>
   <DataGrid appearance="card" ariaLabel="Project milestones" rowNumbers={false} selectable={false} showToolbar={false} data={project.milestones} getRowId={m=>m.id} columns={[{id:'title',header:'Milestone',accessorFn:m=>m.title},{id:'due',header:'Due',accessorFn:m=>m.dueDate},{id:'progress',header:'Progress',accessorFn:m=>m.progress,meta:{renderCell:m=>m.acceptedAt?'Accepted':`${m.progress}% complete`}}]} emptyTitle="No milestones shared yet" emptyDescription="Your team will share confirmed project dates here."/>
   {reports[0]&&<div className={p.section}><h3>Latest update · {reports[0].date}</h3><p>{reports[0].clientSummary||`${reports[0].work.length} work items updated`}</p><Button size="compact" onPress={()=>{setView('daily');setReportId(reports[0].id);}}>View latest update</Button></div>}
  </>}
  {view==='work'&&<DataGrid appearance="card" ariaLabel="Shared work progress" rowNumbers={false} selectable={false} columns={workColumns} data={tasks} getRowId={t=>t.id} onRowAction={t=>setTaskId(t.id)} toolbarActions={<SelectField label={null} aria-label="Room / area" selectedKey={area} onSelectionChange={key=>setArea(String(key))} items={[{id:'all',label:'All rooms'},...areas.map(room=>({id:room,label:room}))]}/>} emptyTitle="No shared work" emptyDescription="Work appears after the team shares an approved update."/>}
  {view==='daily'&&<DataGrid appearance="card" ariaLabel="Shared daily updates" rowNumbers={false} selectable={false} columns={reportColumns} data={reports} getRowId={r=>r.id} onRowAction={r=>setReportId(r.id)} emptyTitle="No daily updates have been shared yet." emptyDescription="Approved updates appear here after your team shares them."/>}
  {view==='files'&&<DataGrid appearance="card" ariaLabel="Approved project documents" rowNumbers={false} selectable={false} data={project.documents} getRowId={d=>d.id} columns={[{id:'title',header:'Document',accessorFn:d=>d.title,meta:{primary:true}},{id:'revision',header:'Revision',accessorFn:d=>d.revision},{id:'kind',header:'Type',accessorFn:d=>label(d.kind)},{id:'action',header:'',enableSorting:false,meta:{renderCell:d=>d.url?<a href={d.url} target="_blank" rel="noreferrer">Open document ↗</a>:<span>File pending</span>}}]} emptyTitle="No project documents have been shared yet." emptyDescription="Approved drawings and project files will appear here."/>}
  {view==='handover'&&(project.handovers.length?handover:empty('Your handover pack will appear after the work and quality checks are complete.'))}
  <ControlledModalDialog isOpen={!!task} onOpenChange={open=>!open&&setTaskId(null)} title={task?.title??'Work details'} size="md">{task&&<div className={p.section}><span className={p.status}>{label(task.status)}</span><p>{task.area} · {task.location==='factory'?'Factory':label(task.location)}</p><p>{task.reportedQuantity} / {task.quantity} {task.unit} in shared updates</p>{task.status==='awaiting_inspection'&&<p>Work is awaiting the quality inspection.</p>}</div>}</ControlledModalDialog>
  <ControlledModalDialog isOpen={!!report} onOpenChange={open=>!open&&setReportId(null)} title={report?`Daily update · ${report.date}`:'Daily update'} size="lg">{report&&<div className={p.section}>{report.clientSummary&&<p style={{whiteSpace:'pre-wrap'}}>{report.clientSummary}</p>}<DataGrid appearance="card" ariaLabel="Reported work" showToolbar={false} rowNumbers={false} selectable={false} data={report.work.map((w,i)=>({...w,id:String(i)}))} getRowId={w=>w.id} columns={[{id:'title',header:'Work',accessorFn:w=>w.title},{id:'quantity',header:'Reported',accessorFn:w=>`${w.quantity} ${w.unit}`},{id:'status',header:'Status',accessorFn:w=>w.status?label(w.status):'Reviewed update'}]}/><div className={p.actions}>{report.files?.map(file=><a key={file.id} className={p.button} href={`/api/client-portal/${slug}/project-files/${project.id}/${file.id}`} target="_blank" rel="noreferrer">{file.name} ↗</a>)}</div>{report.tomorrow&&<><h4>Next steps</h4><p style={{whiteSpace:'pre-wrap'}}>{report.tomorrow}</p></>}</div>}</ControlledModalDialog>
 </>;
}
