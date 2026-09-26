import { ProjectsBoard } from '@/components/projects/projects-board';
import { loadProjectsBoard } from '@/lib/projects/board.server';

export default async function ProjectsEntryPage() {
  return <ProjectsBoard mode="projects" {...await loadProjectsBoard()}/>;
}
