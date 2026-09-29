import * as Crypto from 'expo-crypto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../core/api';
import { useSession } from '../../core/session';

/**
 * The team inbox (WhatsApp, email and portal chats) on the phone, on the web's endpoints: Mine and
 * Unassigned open chats, a thread, a text reply or an internal note. Templates, labels and snoozing stay
 * on the web.
 */
export type ChatView = 'mine' | 'unassigned';
export type ChatRow = {
  id: string; partyId: string | null; partyName: string | null; leadId: string | null; channel: 'email' | 'whatsapp' | 'phone' | 'internal' | string;
  subject: string | null; status: 'open' | 'snoozed' | 'closed'; ownerMembershipId: string | null; ownerName: string | null;
  lastMessageAt: string | null; lastInboundAt: string | null; waitingSince: string | null; unreadCount: number; version: number;
  lastMessageDirection: 'inbound' | 'outbound' | 'internal' | null; lastMessageText: string | null; lastMessageStatus: string | null;
};
export type ChatMessage = {
  id: string; direction: 'inbound' | 'outbound' | 'internal'; status: string; senderName: string | null; bodyText: string | null;
  hiddenAt: string | null; createdAt: string; failureCode: string | null; metadata?: Record<string, unknown> | null;
};

export const chatKeys = {
  all: (ws: string) => ['chats', ws] as const,
  list: (ws: string, view: ChatView) => ['chats', ws, 'list', view] as const,
  thread: (ws: string, id: string) => ['chats', ws, 'thread', id] as const,
};

/** Only people who handle client messages see chats; the server decides every request. */
export function useCanChat() {
  const session = useSession();
  return session.has('crm') && session.can('crm.communications.view');
}

export function useChats(view: ChatView, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: chatKeys.list(api.workspaceId, view),
    queryFn: () => api.get<{ data: ChatRow[]; nextCursor: string | null }>(`crm/conversations?view=${view}&status=open&sort=waiting&limit=50`),
    enabled,
    refetchInterval: 30_000,
  });
}

/** One chat with its latest messages, whether this person may reply, and the WhatsApp 24-hour window. */
export type ChatDetail = Omit<ChatRow, 'lastMessageDirection' | 'lastMessageText' | 'lastMessageStatus'> & {
  canSend: boolean; windowClosesAt: string | null; blockedAt: string | null; leadReference: string | null; messages: ChatMessage[];
};

export function useChat(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: chatKeys.thread(api.workspaceId, id),
    queryFn: () => api.get<ChatDetail>(`crm/conversations/${id}`),
    refetchInterval: 15_000,
  });
}

/** WhatsApp lets a free-text reply only within 24 hours of the client's last message; after it, a template (on the web). */
export const replyWindowOpen = (chat: Pick<ChatDetail, 'channel' | 'windowClosesAt'>, now = Date.now()) =>
  chat.channel !== 'whatsapp' || (!!chat.windowClosesAt && Date.parse(chat.windowClosesAt) > now);

export function useMarkChatRead(id: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.send(`crm/conversations/${id}/read`, 'POST'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['chats', api.workspaceId, 'list'] }),
  });
}

/** A reply to the client (`outbound`) or a note only the team sees (`internal`); a retry keeps its message id. */
export function useSendChat(id: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ text, internal, clientMessageId = Crypto.randomUUID() }: { text: string; internal: boolean; clientMessageId?: string }) =>
      api.send(`crm/conversations/${id}/messages`, 'POST', { clientMessageId, direction: internal ? 'internal' : 'outbound', bodyText: text.trim() }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: chatKeys.all(api.workspaceId) }),
  });
}
