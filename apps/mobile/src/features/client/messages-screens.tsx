import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, CheckCheck, ChevronLeft, HelpCircle, MessageSquarePlus, MessagesSquare } from 'lucide-react-native';
import { useT } from '../../core/i18n';
import { usePortal, usePortalFormat, useProject, useRefreshPortal } from '../../portal/provider';
import type { PortalRequest } from '../../portal/types';
import { TextField } from '../../ui/fields';
import { Empty, Failure, ListRow, Loading, Screen, Section } from '../../ui/layout';
import { Avatar, Button, Chip, IconButton, Row, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { useTheme } from '../../ui/theme';
import { useToast } from '../../ui/toast';
import { AttachPhotos, FileStrip, ProjectSwitcher, StateChip } from './parts';

/**
 * Messages (the web portal's Messages and the team's questions): conversations with the project team, newest first,
 * with unread replies counted, and the questions the team asked the client to answer.
 */
export function ClientMessagesScreen() {
  const t = useT();
  const router = useRouter();
  const format = usePortalFormat();
  const { project, query } = useProject();
  const refresh = useRefreshPortal();
  const [writing, setWriting] = useState(false);
  if (query.isLoading) return <Screen title={t('Messages')} large><Loading count={4} /></Screen>;
  if (query.error && !query.data) return <Screen title={t('Messages')} large><Failure message={query.error.message} onRetry={() => void query.refetch()} /></Screen>;
  const requests = [...(project?.messages?.requests ?? [])].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const questions = project?.decisions?.requests ?? [];
  const canWrite = Boolean(project?.messages);
  return <Screen title={t('Messages')} large below={<ProjectSwitcher />} onRefresh={() => void refresh()} refreshing={query.isRefetching}
    action={canWrite ? <IconButton icon={MessageSquarePlus} label={t('New message')} tone="action" onPress={() => setWriting(true)} /> : undefined}>
    {questions.length ? <Section title={t('Questions from your team')}>
      {questions.map((question, index) => <ListRow key={question.id} first={index === 0} icon={HelpCircle} iconTone={question.canDecide ? 'warning' : 'neutral'} title={question.title}
        detail={question.decision ? question.decision.choiceLabel : question.dueDate ? t('Please answer by {date}', { date: format.day(question.dueDate) }) : question.target}
        trailing={question.canDecide ? <Chip label={t('Waiting for you')} tone="warning" /> : undefined}
        onPress={() => router.push({ pathname: '/portal/question/[id]', params: { id: question.id } } as Href)} />)}
    </Section> : null}
    {requests.length ? <Section title={questions.length ? t('Conversations') : undefined}>
      {requests.map((request, index) => <ListRow key={request.id} first={index === 0} icon={MessagesSquare} title={request.title}
        detail={[lastText(request), format.when(request.lastAt)].filter(Boolean).join(' · ')}
        trailing={request.unread ? <Chip label={String(request.unread)} tone="action" /> : undefined}
        onPress={() => router.push({ pathname: '/portal/thread/[id]', params: { id: request.id } } as Href)} />)}
    </Section> : !questions.length ? <Empty icon={MessagesSquare} title={t('No messages yet')}
      action={canWrite ? { label: t('New message'), onPress: () => setWriting(true) } : undefined} /> : null}
    {project ? <NewMessageSheet open={writing} onClose={() => setWriting(false)} caseId={project.id} /> : null}
  </Screen>;
}

const lastText = (request: PortalRequest) => (request.comments.at(-1)?.text || request.detail || '').replace(/\s+/g, ' ').slice(0, 80);

function NewMessageSheet({ open, onClose, caseId }: { open: boolean; onClose: () => void; caseId: string }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { client } = usePortal();
  const refresh = useRefreshPortal();
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [id, setId] = useState(() => client.newId());
  const [form, setForm] = useState(0);
  const send = async () => {
    setBusy(true);
    try {
      await client.command(id, { action: 'request', caseId, title: title.trim(), detail: detail.trim(), uploadIds: uploads });
      toast.success(t('Your message was sent to your project team.'), 'send');
      setTitle(''); setDetail(''); setId(client.newId()); setForm((value) => value + 1); onClose(); void refresh();
    } catch (cause) { toast.error((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title={t('New message')}
    footer={<Button label={t('Send')} variant="primary" size="lg" full loading={busy} disabled={!title.trim() || !detail.trim() || uploading} onPress={() => void send()} />}>
    <View style={{ gap: theme.space(4) }}>
      <TextField label={t('Subject')} value={title} onChangeText={setTitle} maxLength={240} autoFocus />
      <TextField label={t('Message')} value={detail} onChangeText={setDetail} maxLength={6000} multiline />
      <AttachPhotos key={form} caseId={caseId} onChange={setUploads} onBusy={setUploading} max={10} />
    </View>
  </Sheet>;
}

type Bubble = { id: string; at: string; text: string; files: PortalRequest['files']; fromClient: boolean; author: string | null; mine: boolean; seen: boolean };

/** The bubbles of a conversation, oldest first: the opening message, then the replies (the same order on every device). */
export function bubblesOf(request: PortalRequest): Bubble[] {
  const openedByClient = request.fromClient ?? true;
  const teamAnswered = request.comments.some((comment) => !comment.fromClient);
  const opener: Bubble = { id: request.id, at: request.createdAt, text: request.detail, files: request.files, fromClient: openedByClient, author: request.author ?? null,
    mine: request.mine ?? openedByClient, seen: request.seenByTeam || teamAnswered || request.comments.some((comment) => comment.fromClient && comment.seen) };
  const replies = request.comments.map((comment): Bubble => ({ id: comment.id, at: comment.at, text: comment.text, files: comment.files, fromClient: comment.fromClient,
    author: comment.author ?? null, mine: comment.mine ?? comment.fromClient, seen: comment.seen ?? (comment.fromClient ? request.seenByTeam : true) }));
  return [opener, ...replies].map((bubble, index) => ({ bubble, index }))
    .sort((a, b) => (a.bubble.at < b.bubble.at ? -1 : a.bubble.at > b.bubble.at ? 1 : a.index - b.index)).map(({ bubble }) => bubble);
}

/**
 * One conversation as a chat: the client's side at the end, the project team at the start, a divider for each day,
 * whether the team has seen it, and the reply box with photos at the foot. Opening it marks the team's replies read.
 */
export function ClientThreadScreen({ requestId }: { requestId: string }) {
  const t = useT();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const format = usePortalFormat();
  const { client } = usePortal();
  const refresh = useRefreshPortal();
  const { project } = useProject();
  const request = project?.messages?.requests.find((item) => item.id === requestId) ?? null;
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [id, setId] = useState(() => client.newId());
  const [form, setForm] = useState(0);
  const marked = useRef(false);
  const list = useRef<FlatList<Bubble>>(null);
  useEffect(() => {
    if (marked.current || !request?.unread || !project) return;
    marked.current = true;
    void client.command(client.newId(), { action: 'read_thread', caseId: project.id, requestId: request.id }).then(() => refresh(), () => undefined);
  }, [client, project, refresh, request]);
  const bubbles = useMemo(() => (request ? bubblesOf(request) : []), [request]);
  if (!project || !request) return <Screen title={t('Messages')} back><Empty icon={MessagesSquare} title={t('This conversation isn\'t there any more.')} /></Screen>;
  const send = async () => {
    setBusy(true);
    try {
      await client.command(id, { action: 'comment', caseId: project.id, requestId: request.id, text: text.trim(), uploadIds: uploads });
      setText(''); setId(client.newId()); setForm((value) => value + 1); await refresh();
      setTimeout(() => list.current?.scrollToEnd({ animated: true }), 200);
    } catch (cause) { toast.error((cause as Error).message); }
    finally { setBusy(false); }
  };
  const sender = (bubble: Bubble) => (!bubble.fromClient ? t('Your project team') : bubble.mine ? t('You') : bubble.author || t('Your household'));
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={{ paddingTop: insets.top + theme.space(1), paddingHorizontal: theme.space(4), paddingBottom: theme.space(2), gap: theme.space(1), borderBottomWidth: 1, borderBottomColor: theme.colors.structuralDivider }}>
      <Row style={{ marginStart: -theme.space(3) }}>
        <IconButton icon={ChevronLeft} directional label={t('Back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/portal/messages' as Href))} />
        <View style={{ flex: 1 }}><Text variant="subheading" accessibilityRole="header" numberOfLines={2}>{request.title}</Text></View>
        <StateChip state={request.status} />
      </Row>
    </View>
    <FlatList ref={list} data={bubbles} keyExtractor={(bubble) => bubble.id} contentContainerStyle={{ padding: theme.space(4), gap: theme.space(2) }}
      onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })} accessibilityLabel={t('Messages')}
      ListFooterComponent={request.resolution ? <Text variant="caption" tone="secondary" style={{ paddingTop: theme.space(2) }}>{request.resolution}</Text> : null}
      renderItem={({ item: bubble, index }) => {
        const previous = bubbles[index - 1];
        const newDay = !previous || format.dayOf(previous.at) !== format.dayOf(bubble.at);
        const continued = Boolean(previous) && !newDay && previous.fromClient === bubble.fromClient && previous.author === bubble.author && Date.parse(bubble.at) - Date.parse(previous.at) < 600_000;
        return <Fragment>
          {newDay ? <Text variant="caption" tone="tertiary" style={{ alignSelf: 'center', paddingVertical: theme.space(2) }}>{format.day(bubble.at)}</Text> : null}
          <View accessibilityLabel={sender(bubble)} style={{ alignSelf: bubble.fromClient ? 'flex-end' : 'flex-start', maxWidth: '85%', gap: theme.space(1),
            padding: theme.space(3), borderRadius: theme.radius.lg, backgroundColor: bubble.fromClient ? theme.colors.actionPrimarySubtle : theme.colors.surface,
            borderWidth: bubble.fromClient ? 0 : 1, borderColor: theme.colors.structuralDivider }}>
            {!continued ? <Row gap={2}><Avatar name={sender(bubble)} size={22} /><Text variant="caption" tone="secondary">{sender(bubble)}</Text></Row> : null}
            {bubble.text ? <Text>{bubble.text}</Text> : null}
            <FileStrip files={bubble.files} />
            <Row gap={1} style={{ alignSelf: 'flex-end' }}>
              <Text variant="caption" tone="tertiary">{format.time(bubble.at)}</Text>
              {bubble.fromClient ? bubble.seen ? <CheckCheck accessibilityLabel={t('Seen by your project team')} color={theme.colors.actionPrimary} size={14} />
                : <Check accessibilityLabel={t('Sent')} color={theme.colors.iconSubtle} size={14} /> : null}
            </Row>
          </View>
        </Fragment>;
      }} />
    <View style={{ paddingHorizontal: theme.space(4), paddingTop: theme.space(2), paddingBottom: Math.max(insets.bottom, theme.space(3)), gap: theme.space(2),
      borderTopWidth: 1, borderTopColor: theme.colors.structuralDivider, backgroundColor: theme.colors.surface }}>
      <TextField label={t('Reply')} value={text} onChangeText={setText} maxLength={6000} multiline />
      <Row style={{ justifyContent: 'space-between' }} align="flex-start">
        <View style={{ flex: 1 }}><AttachPhotos key={form} caseId={project.id} onChange={setUploads} onBusy={setUploading} max={6} /></View>
        <Button label={t('Send')} variant="primary" loading={busy} disabled={(!text.trim() && !uploads.length) || uploading} onPress={() => void send()} />
      </Row>
    </View>
  </KeyboardAvoidingView>;
}

/** A question the team asked, with the answers they offered; answered once. */
export function ClientQuestionScreen({ questionId }: { questionId: string }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const format = usePortalFormat();
  const router = useRouter();
  const { client } = usePortal();
  const refresh = useRefreshPortal();
  const { project } = useProject();
  const question = project?.decisions?.requests.find((item) => item.id === questionId) ?? null;
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [id] = useState(() => client.newId());
  if (!project || !question) return <Screen title={t('Question to answer')} back><Empty icon={HelpCircle} title={t('This question isn\'t there any more.')} /></Screen>;
  const send = async () => {
    setBusy(true);
    try {
      await client.command(id, { action: 'request_answer', caseId: project.id, requestId: question.id, choiceId: choice, note: note.trim() });
      toast.success(t('Thank you. Your decision was sent to your project team.'), 'send'); await refresh(); router.back();
    } catch (cause) { toast.error((cause as Error).message); setBusy(false); }
  };
  return <Screen title={question.title} back keyboard
    footer={question.canDecide ? <Button label={t('Send')} variant="primary" size="lg" full loading={busy} disabled={!choice} onPress={() => void send()} /> : undefined}>
    {question.detail ? <Text>{question.detail}</Text> : null}
    <Text variant="caption" tone="secondary">{[question.target, question.dueDate ? t('Please answer by {date}', { date: format.day(question.dueDate) }) : ''].filter(Boolean).join(' · ')}</Text>
    {question.decision ? <Text variant="label">{question.decision.choiceLabel}{question.decision.note ? ` · ${question.decision.note}` : ''}</Text> : null}
    {question.canDecide ? <View style={{ gap: theme.space(3) }}>
      <Text variant="label">{t('Your answer')}</Text>
      <Row wrap gap={2}>{question.choices.map((item) => <Chip key={item.id} label={item.label} selected={choice === item.id} onPress={() => setChoice(item.id)} />)}</Row>
      <TextField label={t('Anything to add? (optional)')} value={note} onChangeText={setNote} maxLength={6000} multiline />
    </View> : null}
  </Screen>;
}
