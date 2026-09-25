import { ProjectsBoard } from '@/components/projects/projects-board';
import type { PortfolioRow } from '@/components/projects/project-portfolio';
import { projectRead } from '@/lib/projects/server';
import { getPreProjects } from '@/lib/pre-project/server';
import type { ProjectWorkflowTemplatesResponse } from '@/lib/projects/workflow-templates';
export default async function ProjectsEntryPage() {
  const [execution, planning, workflow] = await Promise.allSettled([projectRead<PortfolioRow[]>('portfolio'), getPreProjects(new URLSearchParams()), projectRead<ProjectWorkflowTemplatesResponse>('workflow-templates')]);
  if (planning.status === 'rejected') throw planning.reason;
  const data = planning.value;
  const palmFlowEnabled = workflow.status === 'fulfilled' && workflow.value.data.defaultTemplate.code === 'palm_design_build_delivery';
  for (let page=2; data.items.length < data.total && !data.error; page++) {
    const next = await getPreProjects(new URLSearchParams({page:String(page)}));
    if (next.error) { data.error=next.error; break; }
    if (!next.items.length) break;
    const fresh=next.items.filter(item=>!data.items.some(existing=>existing.id===item.id));
    if (!fresh.length) break;
    data.items.push(...fresh);
  }
  return <ProjectsBoard projects={execution.status === 'fulfilled' ? execution.value.data : []} planning={data} palmFlowEnabled={palmFlowEnabled} projectError={execution.status === 'rejected' ? 'Projects could not be loaded. Check your access or refresh.' : workflow.status === 'rejected' ? 'Project workflow could not be loaded. Refresh to confirm which records belong in Planning.' : undefined}/>;
}
