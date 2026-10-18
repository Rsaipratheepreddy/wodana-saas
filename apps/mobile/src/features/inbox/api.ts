import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../core/api';
import { canUseInbox } from '../../core/access';
import { useSession } from '../../core/session';

export type InboxNotification = {
  id: string; eventType: string; status: string; subject: string | null; body: string;
  deepLink: string | null; deliveredAt: string | null; readAt: string | null; createdAt: string; version: number;
  /** The same notice on the web, for the ones the app has no screen for. */
  webUrl?: string | null;
};

export const inboxKey = (ws: string) => ['inbox', ws] as const;

/** My in-app notices from every module (newest first); polled while the app is open. */
export function useInbox() {
  const api = useApi();
  const session = useSession();
  const enabled = canUseInbox(session);
  const query = useQuery({
    queryKey: inboxKey(api.workspaceId),
    queryFn: () => api.get<InboxNotification[]>('crm/notifications'),
    enabled,
    refetchInterval: 60_000,
    staleTime: 20_000,
  });
  const unread = (query.data ?? []).filter((item) => !item.readAt).length;
  return { ...query, enabled, unread };
}

export function useMarkRead() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.send<{ id: string; readAt: string }>(`crm/notifications/${id}/read`, 'POST'),
    onMutate: async (id) => {
      const key = inboxKey(api.workspaceId);
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<InboxNotification[]>(key, (items) => items?.map((item) => (item.id === id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item)));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: inboxKey(api.workspaceId) }),
  });
}

export function useMarkAllRead() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.send<{ updated: number }>('crm/notifications/read-all', 'POST'),
    onMutate: () => {
      queryClient.setQueryData<InboxNotification[]>(inboxKey(api.workspaceId), (items) => items?.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: inboxKey(api.workspaceId) }),
  });
}
