import { redirect } from 'next/navigation';
import { ClientProjects } from '@/components/projects/client-projects';
import { getAuthenticatedProfile } from '@/lib/auth/server';

/** Clients: each client's project and where it really is (its current stage, read from Projects). */
export default async function ClientsPage() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect('/login');
  return <ClientProjects workspaceId={membership.workspaceId} />;
}
