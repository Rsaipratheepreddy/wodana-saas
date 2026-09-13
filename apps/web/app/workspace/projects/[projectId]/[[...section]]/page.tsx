import {notFound,redirect} from 'next/navigation';
import {getProject} from '@/lib/projects/server';
import {projectTabs} from '@/lib/projects/execution';
import {ProjectWorkspace} from '@/components/projects/project-workspace';
export default async function ProjectPage({params}:{params:Promise<{projectId:string;section?:string[]}>}){const {projectId,section}=await params;if(!/^[0-9a-f-]{36}$/i.test(projectId))notFound();if(!section?.length)redirect(`/workspace/projects/${projectId}/overview`);const selected=section.join('/');if(!projectTabs.some(([id])=>id===selected))notFound();const {data}=await getProject(projectId);return <ProjectWorkspace key={`${projectId}-${selected}`} initial={data} section={selected}/>;}
