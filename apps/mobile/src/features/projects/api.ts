import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OpenWork, ProjectDetail, ProjectOverview, ProjectRow, WorkBoard, WorkDetail } from '../../../../web/lib/project-core/types';
import type { HandoverState, SitesToday, SiteState } from '../../../../web/lib/site/types';
import { useApi } from '../../core/api';
import { useSession } from '../../core/session';

export type * from '../../../../web/lib/project-core/types';
export type { HandoverKind, HandoverPack, HandoverState, Outlook, Safety, SiteLine, SiteReport, SiteReportStatus, SiteState, SitesToday, SiteToday } from '../../../../web/lib/site/types';

export const projectKeys = {
  all: (ws: string) => ['projects', ws] as const,
  list: (ws: string) => ['projects', ws, 'list'] as const,
  detail: (ws: string, id: string) => ['projects', ws, id, 'detail'] as const,
  overview: (ws: string, id: string) => ['projects', ws, id, 'overview'] as const,
  board: (ws: string, id: string) => ['projects', ws, id, 'work'] as const,
  item: (ws: string, id: string, itemId: string) => ['projects', ws, id, 'work', itemId] as const,
  openWork: (ws: string, view: 'mine' | 'all') => ['projects', ws, 'open-work', view] as const,
  site: (ws: string, id: string) => ['projects', ws, id, 'site'] as const,
  handover: (ws: string, id: string) => ['projects', ws, id, 'handover'] as const,
  sitesToday: (ws: string) => ['projects', ws, 'sites-today'] as const,
};

const useOn = () => {
  const session = useSession();
  return session.has('projects') && session.can('projects.view', 'projects.manage');
};

export function useProjects() {
  const api = useApi();
  return useQuery({ queryKey: projectKeys.list(api.workspaceId), queryFn: () => api.get<{ projects: ProjectRow[]; canStart: boolean }>('project-core/projects'), enabled: useOn() });
}

export function useProject(id: string) {
  const api = useApi();
  return useQuery({ queryKey: projectKeys.detail(api.workspaceId, id), queryFn: () => api.get<ProjectDetail>(`project-core/projects/${id}`), enabled: useOn() && !!id });
}

/** What holds a project up, its dates, and its money at a glance for the people who may see it (the server decides). */
export function useProjectOverview(id: string) {
  const api = useApi();
  return useQuery({ queryKey: projectKeys.overview(api.workspaceId, id), queryFn: () => api.get<ProjectOverview>(`project-core/projects/${id}/overview`), enabled: useOn() && !!id });
}

export function useWorkBoard(id: string, enabled = true) {
  const api = useApi();
  const on = useOn();
  return useQuery({ queryKey: projectKeys.board(api.workspaceId, id), queryFn: () => api.get<WorkBoard>(`project-core/projects/${id}/work`), enabled: on && enabled && !!id });
}

export function useWorkItem(projectId: string, itemId: string) {
  const api = useApi();
  return useQuery({ queryKey: projectKeys.item(api.workspaceId, projectId, itemId), queryFn: () => api.get<WorkDetail>(`project-core/projects/${projectId}/work/${itemId}`), enabled: useOn() && !!itemId });
}

export function useOpenWork(view: 'mine' | 'all' = 'mine') {
  const api = useApi();
  return useQuery({ queryKey: projectKeys.openWork(api.workspaceId, view), queryFn: () => api.get<OpenWork>(`project-core/work?view=${view}`), enabled: useOn() });
}

/** My sites today: running projects I'm on whose site work runs today, with my report for the day. */
export function useSitesToday() {
  const api = useApi();
  return useQuery({ queryKey: projectKeys.sitesToday(api.workspaceId), queryFn: () => api.get<SitesToday>('site/today'), enabled: useOn() });
}

export function useSite(id: string, enabled = true) {
  const api = useApi();
  const on = useOn();
  return useQuery({ queryKey: projectKeys.site(api.workspaceId, id), queryFn: () => api.get<SiteState>(`site/projects/${id}`), enabled: on && enabled && !!id });
}

export function useHandover(id: string) {
  const api = useApi();
  return useQuery({ queryKey: projectKeys.handover(api.workspaceId, id), queryFn: () => api.get<HandoverState>(`site/projects/${id}/handover`), enabled: useOn() && !!id });
}

/**
 * A command on a project's work (status, comment, create). The answer is the whole refreshed board, so
 * the cache is replaced with it rather than refetched.
 */
export function useWorkCommand(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.send<WorkBoard>(`project-core/projects/${projectId}/work`, 'POST', body),
    onSuccess: (board) => {
      queryClient.setQueryData(projectKeys.board(api.workspaceId, projectId), board);
      if (board.item) queryClient.setQueryData(projectKeys.item(api.workspaceId, projectId, board.item.id), board.item);
      void queryClient.invalidateQueries({ queryKey: ['projects', api.workspaceId, 'open-work'] });
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(api.workspaceId, projectId) });
    },
  });
}

/** A command on the project's site (save, submit, approve, send back a daily report). */
export function useSiteCommand(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.send<SiteState>(`site/projects/${projectId}`, 'POST', body),
    onSuccess: (state) => { queryClient.setQueryData(projectKeys.site(api.workspaceId, projectId), state); },
  });
}

/** A command on the project itself (confirm a stage check). */
export function useProjectCommand(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.send<ProjectDetail>(`project-core/projects/${projectId}`, 'POST', body),
    onSuccess: (detail) => { queryClient.setQueryData(projectKeys.detail(api.workspaceId, projectId), detail); },
  });
}

/** Where a project's work photos are served (add `?preview=1` for the small copy). */
export const workPhotoPath = (projectId: string, photoId: string, preview = true) => `project-core/projects/${projectId}/photos/${photoId}${preview ? '?preview=1' : ''}`;
export const sitePhotoPath = (projectId: string, photoId: string, preview = true) => `site/projects/${projectId}/photos/${photoId}${preview ? '?preview=1' : ''}`;
