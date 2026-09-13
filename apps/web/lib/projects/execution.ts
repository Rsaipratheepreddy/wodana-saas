export type * from '../../../../services/business-core/src/projects/execution.types';
import type {ProjectData,Task} from '../../../../services/business-core/src/projects/execution.types';
export const projectTabs=[['overview','Dashboard'],['plan-teams','Schedules'],['material-planning','Material planning'],['procurement','Procurement'],['production','Production'],['site-work','Execution'],['daily-progress','Daily progress'],['snagging','Snagging'],['handover','Handover'],['documents','Scope & Design'],['commercial','Budget'],['boq','BOQ']] as const;
export function taskProgress(d:ProjectData,t?:Task):number{const children=t?d.tasks.filter(c=>c.parentId===t.id&&c.status!=='cancelled'):d.tasks.filter(c=>!c.parentId&&c.status!=='cancelled');if(children.length){const w=children.reduce((s,c)=>s+c.weight,0);return w?children.reduce((s,c)=>s+taskProgress(d,c)*c.weight,0)/w:0;}return t?.quantity?Math.min(100,t.approved/t.quantity*100):0;}
export const label=(s:string)=>s.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
export const projectPath=(w:string,p:string)=>`/api/projects/${p}?workspaceId=${w}`;
