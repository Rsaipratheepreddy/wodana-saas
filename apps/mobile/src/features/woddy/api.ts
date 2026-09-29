import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, useApi } from '../../core/api';
import { useSession } from '../../core/session';
import type { WoddyAnswer, WoddyCard, WoddyTurn } from './model';
import { historyFor } from './model';

/** Asking Woddy needs this permission; the workspace's AI switch decides the rest. */
export const AI_USE = 'ai.suggestions.use';
export const aiSettingsKey = (workspaceId: string) => ['ai-settings', workspaceId] as const;

/**
 * Whether Woddy can help here now: the person may use AI, and the workspace turned it on and has it set up
 * (`GET ai-settings`, as the web asks). False until known, so Woddy appears only when it will work.
 */
export function useWoddyReady() {
  const api = useApi();
  const session = useSession();
  const allowed = session.can(AI_USE);
  const settings = useQuery({
    queryKey: aiSettingsKey(api.workspaceId),
    queryFn: () => api.get<{ enabled: boolean; available: boolean; version: number }>('ai-settings'),
    enabled: allowed,
    staleTime: 60_000,
    retry: false,
  });
  return { ready: allowed && !!settings.data?.enabled && !!settings.data.available, loading: allowed && settings.isLoading, settings };
}

/** One question with the conversation so far; an agent run takes a while, so the phone waits longer than usual. */
export function useAskWoddy() {
  const api = useApi();
  return useMutation({
    mutationFn: ({ message, turns }: { message: string; turns: WoddyTurn[] }) =>
      api.send<WoddyAnswer>('ai/agent/runs', 'POST', { message: message.trim().slice(0, 3000), history: historyFor(turns), surface: 'panel' }, { timeoutMs: 170_000 }),
  });
}

/** Confirm (with the items kept ticked) or cancel a card; the answer is the card as it is now. An expired one says so. */
export function useDecideCard() {
  const api = useApi();
  return useMutation({
    mutationFn: async ({ card, decision, selection }: { card: WoddyCard; decision: 'confirm' | 'reject'; selection?: string[] }) => {
      try {
        return await api.send<WoddyCard>(`ai/tool-calls/${card.id}/${decision}`, 'POST', { version: card.version, ...(selection ? { selection } : {}) }, { timeoutMs: 120_000 });
      } catch (error) {
        if (error instanceof ApiError && (error.status === 410 || error.code === 'AI_TOOL_CALL_EXPIRED')) return { ...card, status: 'expired' as const };
        throw error;
      }
    },
  });
}
