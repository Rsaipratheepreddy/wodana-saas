import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Mail, MessageCircle, MessagesSquare, Phone, Send } from 'lucide-react-native';
import { errorMessage, isOffline } from '../../core/api';
import { useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { FilterChips, SegmentedControl, TextField } from '../../ui/fields';
import { Banner, Empty, Failure, ListRow, ListScreen, Loading, Screen } from '../../ui/layout';
import { Button, Text } from '../../ui/primitives';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { replyWindowOpen, useChat, useChats, useMarkChatRead, useSendChat, type ChatMessage, type ChatView } from './chats-api';

const channelIcon = (channel: string) => (channel === 'email' ? Mail : channel === 'phone' ? Phone : channel === 'internal' ? MessagesSquare : MessageCircle);

/** Open chats that are mine or nobody's, longest waiting first; `switcher` flips back to notifications. */
export function ChatsList({ switcher }: { switcher: ReactNode }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const [view, setView] = useState<ChatView>('mine');
  const mine = useChats('mine');
  const unassigned = useChats('unassigned');
  const list = view === 'mine' ? mine : unassigned;
  const count = (rows: { data?: { data: unknown[] } }) => rows.data?.data.length ?? 0;
  return <ListScreen large title={t('Inbox')}
    toolbar={<>{switcher}<FilterChips value={view} onChange={setView} options={[
      { value: 'mine', label: count(mine) ? `${t('Mine')} · ${count(mine)}` : t('Mine') },
      { value: 'unassigned', label: count(unassigned) ? `${t('Unassigned')} · ${count(unassigned)}` : t('Unassigned') },
    ]} /></>}
    items={list.data?.data} keyExtractor={(chat) => chat.id}
    loading={list.isLoading} error={list.error ? errorMessage(list.error, t('The inbox could not be loaded.')) : null} onRetry={() => void list.refetch()}
    onRefresh={() => { void mine.refetch(); void unassigned.refetch(); }} refreshing={list.isRefetching}
    empty={<Empty icon={MessagesSquare} title={view === 'mine' ? t('No chats waiting for you') : t('No unassigned chats')} />}
    renderItem={(chat, _, first) => <ListRow first={first} icon={channelIcon(chat.channel)} iconTone={chat.unreadCount ? 'action' : 'neutral'}
      title={chat.partyName ?? chat.subject ?? t('Chat')}
      detail={chat.lastMessageText ? `${chat.lastMessageDirection === 'outbound' ? `${t('You')}: ` : ''}${chat.lastMessageText}` : undefined}
      meta={<Text variant="caption" tone="tertiary">{[view === 'unassigned' ? null : chat.ownerName, chat.lastMessageAt ? format.ago(chat.lastMessageAt) : null].filter(Boolean).join(' · ')}</Text>}
      trailing={chat.unreadCount ? <View accessibilityLabel={t('Unread')} style={{ minWidth: theme.space(5), height: theme.space(5), paddingHorizontal: theme.space(1.5), borderRadius: theme.radius.pill, backgroundColor: theme.colors.actionPrimary, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="caption" style={{ color: theme.colors.actionOnPrimary, fontFamily: theme.font.semibold }}>{chat.unreadCount > 99 ? '99+' : chat.unreadCount}</Text>
      </View> : undefined}
      onPress={() => router.push(`/chats/${chat.id}` as Href)} />} />;
}

/** One chat: the thread, then a reply to the client or a note for the team. */
export function ChatScreen({ id }: { id: string }) {
  const t = useT();
  const theme = useTheme();
  const format = useFormat();
  const toast = useToast();
  const chat = useChat(id);
  const markRead = useMarkChatRead(id);
  const send = useSendChat(id);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const scroller = useRef<ScrollView>(null);
  const unread = chat.data?.unreadCount ?? 0;
  useEffect(() => { if (unread > 0) markRead.mutate(); }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps
  const messages = useMemo(() => (chat.data?.messages ?? []).filter((message) => message.bodyText || message.hiddenAt), [chat.data]);

  if (chat.isLoading) return <Screen back title={t('Chat')}><Loading count={6} /></Screen>;
  if (chat.error || !chat.data) return <Screen back title={t('Chat')}><Failure message={errorMessage(chat.error, t('The chat could not be loaded.'))} onRetry={() => void chat.refetch()} /></Screen>;
  const detail = chat.data;
  const open = replyWindowOpen(detail);
  const note = mode === 'note';
  const blocked = !!detail.blockedAt;
  const canWrite = detail.canSend && !blocked && (note || open);
  const submit = () => {
    const body = text.trim();
    if (!body || send.isPending) return;
    send.mutate({ text: body, internal: note }, {
      onSuccess: () => { setText(''); toast.success(note ? t('Note added') : t('Sent'), note ? undefined : 'send'); },
      onError: (error) => toast.error(isOffline(error) ? t('Replies need a connection.') : errorMessage(error, t('Something went wrong'))),
    });
  };
  return <Screen back title={detail.partyName ?? detail.subject ?? t('Chat')} subtitle={[detail.leadReference, detail.ownerName].filter(Boolean).join(' · ') || undefined} keyboard scroll={false}
    footer={detail.canSend ? <View style={{ gap: theme.space(2) }}>
      <SegmentedControl value={mode} onChange={setMode} options={[{ value: 'reply', label: t('Reply') }, { value: 'note', label: t('Internal note') }]} />
      {!note && !open ? <Banner tone="warning" title={t('The 24-hour reply window has closed')} detail={t('Send a template from the web to reopen it.')} /> : null}
      {blocked ? <Banner tone="neutral" title={t('This contact is blocked')} /> : null}
      <TextField label={note ? t('Note') : t('Reply')} value={text} onChangeText={setText} multiline maxLength={4000} editable={canWrite && !send.isPending}
        placeholder={note ? t('Only your team sees this') : t('Write a reply')} />
      <Button label={note ? t('Add note') : t('Send')} icon={Send} variant="primary" size="lg" full loading={send.isPending} disabled={!canWrite || !text.trim()} onPress={submit} />
    </View> : undefined}>
    <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ gap: theme.space(2), paddingBottom: theme.space(4) }}
      onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
      {messages.length ? messages.map((message) => <Bubble key={message.id} message={message} when={format.when(message.createdAt)} />)
        : <Empty icon={MessagesSquare} title={t('No messages yet')} />}
    </ScrollView>
  </Screen>;
}

function Bubble({ message, when }: { message: ChatMessage; when: string }) {
  const t = useT();
  const theme = useTheme();
  const outbound = message.direction === 'outbound';
  const internal = message.direction === 'internal';
  const failed = message.status === 'failed';
  return <View style={{ alignSelf: outbound || internal ? 'flex-end' : 'flex-start', maxWidth: '85%', gap: theme.space(1),
    padding: theme.space(3), borderRadius: theme.radius.lg,
    backgroundColor: internal ? theme.colors.warningSubtle : outbound ? theme.colors.actionPrimarySubtle : theme.colors.surfaceMuted }}>
    {internal ? <Text variant="overline" tone="warning">{t('Internal note')}</Text> : null}
    <Text>{message.hiddenAt ? t('Hidden') : message.bodyText}</Text>
    <Text variant="caption" tone={failed ? 'danger' : 'tertiary'}>{[message.senderName, when, failed ? t('Not delivered') : null].filter(Boolean).join(' · ')}</Text>
  </View>;
}
