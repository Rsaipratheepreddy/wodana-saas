import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Clock3, FileText, FileX, LayoutTemplate, Mail, MessageCircle, MessagesSquare, Phone, Play, Send } from 'lucide-react-native';
import { useAuth } from '../../auth/provider';
import { errorMessage, isOffline, useApi } from '../../core/api';
import { openWorkspaceFile } from '../../core/files';
import { useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { FilterChips, SegmentedControl, TextField } from '../../ui/fields';
import { Banner, Empty, Failure, ListRow, ListScreen, Loading, Screen, Section } from '../../ui/layout';
import { PhotoGrid } from '../../ui/photos';
import { Button, Row, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { attachmentPath, captionOf, fillTemplate, hasContent, renderTemplate, sendableTemplate, templateOf, type ChatAttachment, type ChatTemplate } from './chat-content';
import { replyWindowOpen, useChat, useChatTemplates, useChatValues, useChats, useMarkChatRead, useSendChat, type ChatMessage, type ChatView } from './chats-api';

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
  const [picking, setPicking] = useState(false);
  const messages = useMemo(() => (chat.data?.messages ?? []).filter(hasContent), [chat.data]);

  if (chat.isLoading) return <Screen back title={t('Chat')}><Loading count={6} /></Screen>;
  if (chat.error || !chat.data) return <Screen back title={t('Chat')}><Failure message={errorMessage(chat.error, t('The chat could not be loaded.'))} onRetry={() => void chat.refetch()} /></Screen>;
  const detail = chat.data;
  const open = replyWindowOpen(detail);
  const note = mode === 'note';
  const blocked = !!detail.blockedAt;
  const canWrite = detail.canSend && !blocked && (note || open);
  // WhatsApp templates reach the client any time, and reopen a closed 24-hour window.
  const canTemplate = detail.canSend && !blocked && !note && detail.channel === 'whatsapp';
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
      {!note && !open ? <Banner tone="warning" title={t('The 24-hour reply window has closed')} detail={t('Send a template to reopen it.')}
        action={canTemplate ? { label: t('Send a template'), onPress: () => setPicking(true) } : undefined} /> : null}
      {blocked ? <Banner tone="neutral" title={t('This contact is blocked')} /> : null}
      {note || open ? <>
        <TextField label={note ? t('Note') : t('Reply')} value={text} onChangeText={setText} multiline maxLength={4000} editable={canWrite && !send.isPending}
          placeholder={note ? t('Only your team sees this') : t('Write a reply')} />
        <Row gap={2}>
          {canTemplate ? <Button label={t('Template')} icon={LayoutTemplate} size="lg" onPress={() => setPicking(true)} /> : null}
          <View style={{ flex: 1 }}><Button label={note ? t('Add note') : t('Send')} icon={Send} variant="primary" size="lg" full loading={send.isPending} disabled={!canWrite || !text.trim()} onPress={submit} /></View>
        </Row>
      </> : null}
    </View> : undefined}>
    <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ gap: theme.space(2), paddingBottom: theme.space(4) }}
      onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
      {messages.length ? messages.map((message) => <Bubble key={message.id} chatId={id} message={message} when={format.when(message.createdAt)} />)
        : <Empty icon={MessagesSquare} title={t('No messages yet')} />}
    </ScrollView>
    <TemplatePicker chatId={id} open={picking} onClose={() => setPicking(false)} onSent={() => { setPicking(false); toast.success(t('Sent'), 'send'); }} />
  </Screen>;
}

/**
 * Send an approved WhatsApp template: its values come from the chat's records (client name, enquiry, project…);
 * a value the chat doesn't have is typed for this message. Only approved, numbered templates can be sent.
 */
function TemplatePicker({ chatId, open, onClose, onSent }: { chatId: string; open: boolean; onClose: () => void; onSent: () => void }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const templates = useChatTemplates(open);
  const values = useChatValues(chatId, open);
  const send = useSendChat(chatId);
  const [chosen, setChosen] = useState<ChatTemplate | null>(null);
  const [typed, setTyped] = useState<Record<number, string>>({});
  const usable = (templates.data ?? []).filter(sendableTemplate);
  const filled = chosen ? fillTemplate(chosen, values.data ?? {}) : null;
  const parameters = filled && chosen ? filled.parameters.map((value, index) => value || (typed[chosen.positions[index]] ?? '').trim()) : [];
  const stillMissing = filled?.missing.filter((item) => !(typed[item.position] ?? '').trim()) ?? [];
  const close = () => { setChosen(null); setTyped({}); onClose(); };
  const submit = () => {
    if (!chosen || stillMissing.length || send.isPending) return;
    send.mutate({ template: { id: chosen.id, ...(filled?.missing.length ? { parameters } : {}) } }, {
      onSuccess: () => { setChosen(null); setTyped({}); onSent(); },
      onError: (error) => toast.error(isOffline(error) ? t('Replies need a connection.') : errorMessage(error, t('Something went wrong'))),
    });
  };
  return <Sheet open={open} onClose={close} title={chosen ? chosen.code : t('Send a template')} full={!chosen}
    footer={chosen ? <Row gap={2}>
      <Button label={t('Back')} size="lg" onPress={() => { setChosen(null); setTyped({}); }} />
      <View style={{ flex: 1 }}><Button label={t('Send template')} icon={Send} variant="primary" size="lg" full loading={send.isPending} disabled={stillMissing.length > 0} onPress={submit} /></View>
    </Row> : undefined}>
    {templates.isLoading || values.isLoading ? <Loading count={4} />
      : templates.error ? <Failure message={errorMessage(templates.error, t('Templates could not be loaded.'))} onRetry={() => void templates.refetch()} />
      : chosen && filled ? <View style={{ gap: theme.space(3) }}>
        <View style={{ padding: theme.space(3), borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceMuted }}><Text>{renderTemplate(chosen.body, parameters)}</Text></View>
        {filled.missing.map((item) => <TextField key={`${chosen.id}:${item.position}`} label={`{{${item.position}}}`} value={typed[item.position] ?? ''} maxLength={1024}
          onChangeText={(value) => setTyped((current) => ({ ...current, [item.position]: value }))} placeholder={t('This chat has no value for it. Type it for this message.')} />)}
      </View>
      : usable.length ? <Section>{usable.map((template, index) => <ListRow key={template.id} first={index === 0} icon={LayoutTemplate} title={template.code}
        detail={renderTemplate(template.body, fillTemplate(template, values.data ?? {}).parameters)} meta={<Text variant="caption" tone="tertiary">{template.locale}</Text>}
        onPress={() => { setChosen(template); setTyped({}); }} />)}</Section>
      : <Empty icon={LayoutTemplate} title={t('No approved templates yet')} detail={t('Templates are added and approved on the web.')} />}
  </Sheet>;
}

function Bubble({ chatId, message, when }: { chatId: string; message: ChatMessage; when: string }) {
  const t = useT();
  const theme = useTheme();
  const outbound = message.direction === 'outbound';
  const internal = message.direction === 'internal';
  const failed = message.status === 'failed';
  const template = templateOf(message);
  const caption = captionOf(message);
  return <View style={{ alignSelf: outbound || internal ? 'flex-end' : 'flex-start', width: message.attachment && !message.hiddenAt ? '85%' : undefined, maxWidth: '85%', gap: theme.space(1),
    padding: theme.space(3), borderRadius: theme.radius.lg,
    backgroundColor: internal ? theme.colors.warningSubtle : outbound ? theme.colors.actionPrimarySubtle : theme.colors.surfaceMuted }}>
    {internal ? <Text variant="overline" tone="warning">{t('Internal note')}</Text> : null}
    {message.hiddenAt ? <Text>{t('Hidden')}</Text> : <>
      {message.attachment ? <ChatFile chatId={chatId} file={message.attachment} /> : null}
      {caption ? <Text>{caption}</Text> : null}
      {template ? <Row gap={1}><LayoutTemplate size={12} color={theme.colors.textTertiary} /><Text variant="caption" tone="tertiary">{t('Template · {code}', { code: template })}</Text></Row> : null}
    </>}
    <Text variant="caption" tone={failed ? 'danger' : 'tertiary'}>{[message.senderName, when, failed ? t('Not delivered') : null].filter(Boolean).join(' · ')}</Text>
  </View>;
}

/**
 * A chat file: a photo as a thumbnail that opens full size; a voice note, video or document opens in the phone's viewer.
 * One still being fetched says so; one that is lost says why.
 */
function ChatFile({ chatId, file }: { chatId: string; file: ChatAttachment }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { client } = useAuth();
  const api = useApi();
  const [opening, setOpening] = useState(false);
  const kindName = file.kind === 'audio' ? t('Voice note') : file.kind === 'video' ? t('Video') : file.kind === 'document' ? t('Document') : t('Photo');
  const name = file.fileName ?? kindName;
  if (file.status === 'pending') return <Row gap={2}><Clock3 size={16} color={theme.colors.textTertiary} /><Text variant="caption" tone="tertiary" accessibilityLiveRegion="polite">{t('Getting the file…')}</Text></Row>;
  if (file.status === 'failed') return <Row gap={2}><FileX size={16} color={theme.colors.textTertiary} /><Text variant="caption" tone="tertiary">
    {file.failureCode === 'media_expired' || file.failureCode === 'media_unavailable' ? t('WhatsApp no longer has this file.') : t("This file couldn't be kept.")}</Text></Row>;
  const path = attachmentPath(chatId, file.id);
  if (file.kind === 'image' || file.kind === 'sticker') return <PhotoGrid photos={[{ key: file.id, path, label: name }]} columns={1} />;
  const open = async () => {
    setOpening(true);
    try { await openWorkspaceFile(client, api.url(path), name); }
    catch (error) { toast.error(errorMessage(error, t('The file could not be opened.'))); }
    finally { setOpening(false); }
  };
  return <Pressable accessibilityRole="button" accessibilityLabel={t('Open {name}', { name })} disabled={opening} onPress={() => void open()}
    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space(2), padding: theme.space(2), borderRadius: theme.radius.md,
      backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface })}>
    {file.kind === 'audio' || file.kind === 'video' ? <Play size={16} color={theme.colors.textSecondary} /> : <FileText size={16} color={theme.colors.textSecondary} />}
    <Text numberOfLines={2} style={{ flex: 1 }}>{name}</Text>
    {opening ? <Text variant="caption" tone="tertiary">{t('Opening…')}</Text> : null}
  </Pressable>;
}
