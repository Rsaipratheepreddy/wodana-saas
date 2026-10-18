import { useCallback, useRef } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import type { HomeMetrics, HomeSummary } from '../../../../../packages/contracts/src/home';
import type { MyDayActionResult, MyDayItem, MyDayResponse, MyDayUrgency } from '../../../../../packages/contracts/src/reminders';
import { useApi } from '../../core/api';
import { applyActionResult, snoozeInput } from './my-day-model';

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

/** One list serves Today and the full My day: enough rows for both, the server sorts and filters by permission. */
export const MY_DAY_LIMIT = 100;
export const myDayKeys = {
  all: (ws: string) => ['my-day', ws] as const,
  list: (ws: string, urgency: MyDayUrgency | null) => ['my-day', ws, urgency ?? 'all'] as const,
};

/**
 * My day (`GET my-day`, plan §6.24a): what is due for me, grouped by job. It refreshes every minute while shown,
 * when a push arrives (`shell/notifications.ts`) and when its screen comes back into view (`useRefetchOnFocus`).
 */
export function useMyDay(urgency: MyDayUrgency | null = null) {
  const api = useApi();
  return useQuery({
    queryKey: myDayKeys.list(api.workspaceId, urgency),
    queryFn: () => api.get<MyDayResponse>(`my-day?scope=me&limit=${MY_DAY_LIMIT}${urgency ? `&urgency=${urgency}` : ''}`),
    refetchInterval: 60_000,
    // Switching a chip keeps the rows on screen (filtered here) until the server's answer lands.
    placeholderData: keepPreviousData,
  });
}

/** Refetch when the screen comes back into view (its first appearance loads anyway). */
export function useRefetchOnFocus(refetch: () => unknown) {
  const latest = useRef(refetch);
  latest.current = refetch;
  const seen = useRef(false);
  useFocusEffect(useCallback(() => {
    if (seen.current) void latest.current();
    seen.current = true;
  }, []));
}

export type MyDayCommand =
  | { kind: 'snooze'; item: MyDayItem; until: string; reason: string }
  | { kind: 'complete'; item: MyDayItem }
  | { kind: 'unsnooze'; item: MyDayItem };

/**
 * Snooze, done and wake now. Each sends the version the person saw; the answer (the item as it is now, or null
 * when it closed) updates every cached My day list at once, then the lists refetch for the server's counts.
 */
export function useMyDayCommand() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: MyDayCommand) => {
      const path = `my-day/${encodeURIComponent(command.item.id)}/${command.kind}`;
      const body = command.kind === 'snooze' ? snoozeInput(command.item, command.until, command.reason) : { version: command.item.version };
      return api.send<MyDayActionResult>(path, 'POST', body);
    },
    onSuccess: (result, command) => {
      queryClient.setQueriesData<MyDayResponse>({ queryKey: myDayKeys.all(api.workspaceId) }, (data) => (data ? applyActionResult(data, command.item.id, result.item) : data));
    },
    // Whatever happened (someone else may have moved it), the lists show what is due now.
    onSettled: () => queryClient.invalidateQueries({ queryKey: myDayKeys.all(api.workspaceId) }),
  });
}
