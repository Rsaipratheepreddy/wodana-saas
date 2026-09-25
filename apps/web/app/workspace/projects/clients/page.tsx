import { ClientProjects } from '@/components/projects/client-projects';
import type { PortfolioRow } from '@/components/projects/project-portfolio';
import { projectRead } from '@/lib/projects/server';

export default async function ClientsPage() {
  const result = await projectRead<PortfolioRow[]>('portfolio');
  return <ClientProjects rows={result.data} />;
}
