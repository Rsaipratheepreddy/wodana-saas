import { useQuery } from '@tanstack/react-query';
import type { HomeMetrics, HomeSummary } from '../../../../../packages/contracts/src/home';
import { useApi } from '../../core/api';

export const homeKeys = {
  summary: (ws: string) => ['home', ws, 'summary'] as const,
  metrics: (ws: string) => ['home', ws, 'metrics'] as const,
};

/** Home's overview for this person (the web's): what needs them, what's coming, the pipeline they can see. */
export function useHomeSummary() {
  const api = useApi();
  return useQuery({ queryKey: homeKeys.summary(api.workspaceId), queryFn: () => api.get<HomeSummary>('home/summary'), refetchInterval: 120_000 });
}

/** Home's figures (money, projects, enquiries, quotes, orders); each is present only with its permission. */
export function useHomeMetrics(enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: homeKeys.metrics(api.workspaceId), queryFn: () => api.get<HomeMetrics>('home/metrics'), enabled, staleTime: 5 * 60_000 });
}
