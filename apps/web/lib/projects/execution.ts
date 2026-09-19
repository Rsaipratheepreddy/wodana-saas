export type * from '../../../../services/business-core/src/projects/execution.types';
import type {ProjectData,ProjectExecutionAction,Task} from '../../../../services/business-core/src/projects/execution.types';
export const projectTabs=[['overview','Dashboard'],['plan-teams','Schedules'],['material-planning','Material planning'],['procurement','Procurement'],['production','Production'],['site-work','Execution'],['daily-progress','Daily progress'],['snagging','Snagging'],['handover','Handover'],['documents','Scope & Design'],['commercial','Budget'],['boq','BOQ']] as const;
export function taskProgress(d:ProjectData,t?:Task):number{const children=t?d.tasks.filter(c=>c.parentId===t.id&&c.status!=='cancelled'):d.tasks.filter(c=>!c.parentId&&c.status!=='cancelled');if(children.length){const w=children.reduce((s,c)=>s+c.weight,0);return w?children.reduce((s,c)=>s+taskProgress(d,c)*c.weight,0)/w:0;}return t?.quantity?Math.min(100,t.approved/t.quantity*100):0;}
export const label=(s:string)=>s.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
export const projectPath=(w:string,p:string)=>`/api/projects/${p}?workspaceId=${w}`;

/** Routes a backend decision to the part of the project that owns the record. */
export function projectActionRoute(projectId: string, action: ProjectExecutionAction): string {
  const section = action.kind.includes("handover") ? "handover"
    : action.kind.includes("warranty") ? "snagging"
    : action.kind.includes("factory") || action.kind.includes("dispatch") ? "production"
    : action.kind.includes("report") || action.kind.includes("site_update") || action.kind.includes("site_incident") ? "daily-progress"
    : action.kind.includes("commissioning") ? "site-work"
    : action.kind.includes("design") ? "documents"
    : action.kind.includes("order") ? "procurement"
    : action.kind.includes("project_") || action.kind.includes("client_") ? "overview"
    : "plan-teams";
  const query = action.recordId && action.recordId !== projectId
    ? `?record=${encodeURIComponent(action.recordId)}`
    : "";
  return `/workspace/projects/${encodeURIComponent(projectId)}/${section}${query}`;
}
