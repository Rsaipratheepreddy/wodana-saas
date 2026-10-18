import { useQuery } from '@tanstack/react-query';
import type { CaseAsset, ScopeEntry } from '../../../../web/lib/pre-project/content';
import type { SiteData, SiteRecord } from '../../../../web/lib/pre-project/site';
import { useApi } from '../../core/api';
import { useSession } from '../../core/session';
import type { DesignJourneyView } from './questions-model';

export type { CaseAsset, ScopeEntry, SiteData, SiteRecord };
export type CaseRow = { id: string; title: string; customerName: string | null; status: string; phase?: string | null; reference?: string | null };
export type CaseDetail = { id: string; title: string; customerName: string | null; status: string; phase: string | null; version: number; projectId: string | null };
export type Brief = { rooms: Array<{ id: string; name: string; version: number }>; entries: ScopeEntry[]; canEdit: boolean; caseStatus: string };

export const surveyKeys = {
  all: (ws: string) => ['survey', ws] as const,
  cases: (ws: string, search: string) => ['survey', ws, 'cases', search] as const,
  case: (ws: string, id: string) => ['survey', ws, 'case', id] as const,
  brief: (ws: string, id: string) => ['survey', ws, 'brief', id] as const,
  site: (ws: string, id: string) => ['survey', ws, 'site', id] as const,
  journey: (ws: string, id: string) => ['survey', ws, 'design-journey', id] as const,
};
const useOn = () => { const session = useSession(); return session.has('pre-project') && session.can('pre_projects.view'); };

export function useCases(search: string) {
  const api = useApi();
  return useQuery({
    queryKey: surveyKeys.cases(api.workspaceId, search),
    queryFn: () => api.get<{ items: CaseRow[]; total: number }>(`pre-projects?status=all&page=1${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    enabled: useOn(),
  });
}
export function useCase(id: string) {
  const api = useApi();
  return useQuery({ queryKey: surveyKeys.case(api.workspaceId, id), queryFn: () => api.get<CaseDetail>(`pre-projects/${id}`), enabled: useOn() && !!id });
}
export function useBrief(id: string) {
  const api = useApi();
  return useQuery({ queryKey: surveyKeys.brief(api.workspaceId, id), queryFn: () => api.get<Brief>(`pre-projects/${id}/brief`), enabled: useOn() && !!id });
}
export function useSurvey(id: string) {
  const api = useApi();
  return useQuery({ queryKey: surveyKeys.site(api.workspaceId, id), queryFn: () => api.get<SiteData>(`pre-projects/${id}/site`), enabled: useOn() && !!id });
}
/** The case's design journey as the site visit reads it: the firm's questions the job carries, its answers and the visit's version. */
export function useDesignJourney(id: string) {
  const api = useApi();
  return useQuery({ queryKey: surveyKeys.journey(api.workspaceId, id), queryFn: () => api.get<DesignJourneyView>(`pre-projects/${id}/design-journey`), enabled: useOn() && !!id });
}
export const assetPath = (caseId: string, assetId: string, preview = true) => `pre-projects/${caseId}/assets/${assetId}${preview ? '?preview=1' : ''}`;
