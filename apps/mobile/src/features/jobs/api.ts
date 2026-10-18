import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ApiError, useApi } from '../../core/api';
import { useSession } from '../../core/session';
import type { JobsMyDay, JobsPage, JourneyView } from './model';

/** The jobs list's permissions (any one): the server scopes what each shows; the app only hides the entry. */
export const JOB_PERMISSIONS = ['crm.leads.view', 'crm.opportunities.view', 'pre_projects.view', 'projects.view', 'projects.manage'] as const;
export const useJobsOn = () => useSession().can(...JOB_PERMISSIONS);

export const jobKeys = {
  all: (ws: string) => ['jobs', ws] as const,
  list: (ws: string) => ['jobs', ws, 'list'] as const,
  journey: (ws: string, id: string) => ['jobs', ws, 'journey', id] as const,
  mine: (ws: string) => ['jobs', ws, 'my-day'] as const,
};
const PAGE = 50;
// A server without the job endpoints yet (an older release) answers 404: the sections stay away instead of an error.
export const missing = (error: unknown) => error instanceof ApiError && error.status === 404;
const retry = (count: number, error: unknown) => !missing(error) && !(error instanceof ApiError && error.status < 500) && count < 2;

/** Every job I see, newest first, a page at a time (`GET jobs/overview`). */
export function useJobs() {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: jobKeys.list(api.workspaceId),
    queryFn: ({ pageParam }) => api.get<JobsPage>(`jobs/overview?limit=${PAGE}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    enabled: useJobsOn(),
    retry,
  });
}

/** One job's journey: chapters, steps, the step now with its owner and done-when (`GET jobs/:id/journey`). */
export function useJourney(jobId: string) {
  const api = useApi();
  return useQuery({ queryKey: jobKeys.journey(api.workspaceId, jobId), queryFn: () => api.get<JourneyView>(`jobs/${jobId}/journey`), enabled: useJobsOn() && !!jobId, retry });
}

/** The steps that are mine now (`GET jobs/my-day`): refreshed every minute while shown, like My day. */
export function useMySteps() {
  const api = useApi();
  return useQuery({ queryKey: jobKeys.mine(api.workspaceId), queryFn: () => api.get<JobsMyDay>('jobs/my-day'), enabled: useJobsOn(), refetchInterval: 60_000, retry });
}
