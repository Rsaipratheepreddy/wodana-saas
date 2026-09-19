import { ProjectFieldWorkspace } from '../projects/ui';

export function ProjectsScreen({ workspaceId, initialRecordId, initialActionId }: { workspaceId: string; initialRecordId?: string | null; initialActionId?: string | null }) {
  return <ProjectFieldWorkspace workspaceId={workspaceId} initialProjectId={initialRecordId} initialActionId={initialActionId} />;
}
