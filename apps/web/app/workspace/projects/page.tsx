import {ProjectPortfolio,type PortfolioRow} from '@/components/projects/project-portfolio';
import {projectRead} from '@/lib/projects/server';
export default async function ProjectsEntryPage(){const {workspaceId,data}=await projectRead<PortfolioRow[]>('portfolio');return <ProjectPortfolio workspaceId={workspaceId} rows={data} today={new Date().toISOString().slice(0,10)}/>;}
