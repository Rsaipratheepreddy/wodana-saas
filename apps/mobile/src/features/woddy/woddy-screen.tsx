import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Image } from 'expo-image';
import { ArrowRight, Check, Send, Sparkles } from 'lucide-react-native';
import { ApiError, errorMessage, isOffline } from '../../core/api';
import { useFormat } from '../../core/format';
import { haptic } from '../../core/haptics';
import { key, useT } from '../../core/i18n';
import { useOnline } from '../../core/query';
import { woddy } from '../../ui/brand-characters';
import { TextField } from '../../ui/fields';
import { Banner, Card, Empty, Fact, Loading, Screen } from '../../ui/layout';
import { Button, Chip, IconButton, Row, Stack, Text } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { useToast } from '../../ui/toast';
import { useAskWoddy, useDecideCard, useWoddyReady } from './api';
import { CARD_STATUS, cardTitle, citedSources, effectiveStatus, recordRoute, refusalOf, withCitations, type WoddyAnswer, type WoddyCard, type WoddyPreviewField, type WoddySource, type WoddyTurn } from './model';

type Message = { id: string; role: 'user' | 'assistant'; text: string; answer?: WoddyAnswer };
type Problem = { kind: 'paused' | 'off' | 'no-access' | 'busy' | 'unavailable' | 'offline'; message: string; question: string };
const SUGGESTIONS = [key('What needs attention today?'), key('What is waiting for my approval?'), key('Explain the flow from enquiry to handover')];

/**
 * Woddy on the phone: ask in plain words; reads answer at once with the records they came from (each opens its
 * screen), and changes come back as cards to confirm or cancel. Hidden when the workspace has AI off.
 */
export function WoddyScreen() {
  const t = useT();
  const theme = useTheme();
  const online = useOnline();
  const { ready, loading } = useWoddyReady();
  const ask = useAskWoddy();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const scroller = useRef<ScrollView>(null);
  const counter = useRef(0);

  const send = (text: string) => {
    const question = text.trim();
    if (!question || ask.isPending) return;
    const turns: WoddyTurn[] = messages.map((message) => ({ role: message.role, text: message.text }));
    setMessages((current) => [...current, { id: `u${++counter.current}`, role: 'user', text: question }]);
    setDraft('');
    setProblem(null);
    haptic.send();
    ask.mutate({ message: question, turns }, {
      onSuccess: (answer) => {
        const words = answer.answer.trim() || (answer.proposals.length ? t('I prepared this for you. Nothing changes until you confirm.') : answer.draft ? '' : t('I couldn\'t find an answer to that.'));
        setMessages((current) => [...current, { id: `a${++counter.current}`, role: 'assistant', text: words, answer }]);
        if (answer.proposals.length) haptic.warning();
      },
      onError: (error) => {
        // The question goes back in the box to try again; it never stays in the thread unanswered.
        setMessages((current) => current.slice(0, -1));
        setDraft(question);
        if (isOffline(error)) { setProblem({ kind: 'offline', message: t('Woddy needs a connection.'), question }); return; }
        const refusal = error instanceof ApiError ? refusalOf(error.status, error.code) : { kind: 'unavailable' as const, message: errorMessage(error, t('Woddy could not reply. Please try again.')) };
        setProblem({ ...refusal, message: t(refusal.message), question });
        if (refusal.kind !== 'paused') haptic.error();
      },
    });
  };

  if (loading) return <Screen back title={t('Woddy')}><Loading count={3} /></Screen>;
  if (!ready) return <Screen back title={t('Woddy')}>
    <Empty icon={Sparkles} title={t('Woddy is off for this workspace. An admin can turn AI on in Settings.')} />
  </Screen>;
  const pose = problem && problem.kind !== 'paused' ? woddy.oops : ask.isPending ? woddy.thinking : messages.length ? woddy.idle : woddy.hello;
  return <Screen back title={t('Woddy')} keyboard scroll={false}
    footer={<Stack gap={2}>
      {problem ? <Banner tone={problem.kind === 'paused' || problem.kind === 'off' ? 'neutral' : 'warning'} title={problem.message}
        action={problem.kind === 'unavailable' || problem.kind === 'busy' || problem.kind === 'offline' ? { label: t('Try again'), onPress: () => send(problem.question) } : undefined} /> : null}
      <Row gap={2} align="flex-end">
        <View style={{ flex: 1 }}>
          <TextField value={draft} onChangeText={setDraft} multiline maxLength={3000} placeholder={t('Ask Woddy…')} accessibilityLabel={t('Message Woddy')}
            editable={!ask.isPending} />
        </View>
        <IconButton icon={Send} label={t('Send message to Woddy')} tone="action" filled size={48} directional disabled={!draft.trim() || ask.isPending || !online} onPress={() => send(draft)} />
      </Row>
      <Text variant="caption" tone="tertiary">{t('Woddy prepares changes; nothing happens until you confirm.')}</Text>
    </Stack>}>
    <ScrollView ref={scroller} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={{ gap: theme.space(3), paddingBottom: theme.space(4) }} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}>
      {!messages.length ? <View style={{ alignItems: 'center', gap: theme.space(3), paddingVertical: theme.space(6) }}>
        <Image source={pose} style={{ width: 120, height: 120 }} contentFit="contain" accessible={false} />
        <Text variant="subheading" style={{ textAlign: 'center' }}>{t('Hey, let’s move work forward.')}</Text>
        <Stack gap={2} style={{ alignSelf: 'stretch' }}>
          {SUGGESTIONS.map((suggestion) => <Button key={suggestion} label={t(suggestion)} variant="secondary" full disabled={!online || ask.isPending} onPress={() => send(t(suggestion))} />)}
        </Stack>
      </View> : messages.map((message) => message.role === 'user'
        ? <View key={message.id} style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: theme.space(3), borderRadius: theme.radius.lg, backgroundColor: theme.colors.actionPrimarySubtle }}>
          <Text>{message.text}</Text>
        </View>
        : <AnswerView key={message.id} text={message.text} answer={message.answer!} />)}
      {ask.isPending ? <Row gap={2}>
        <Image source={woddy.thinking} style={{ width: 40, height: 40 }} contentFit="contain" accessible={false} />
        <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">{t('Woddy is typing…')}</Text>
      </Row> : null}
    </ScrollView>
  </Screen>;
}

/** Woddy's way in, at the top of Today: only when the person may ask and the workspace has AI on. */
export function WoddyButton() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { ready } = useWoddyReady();
  if (!ready) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={t('Ask Woddy')} hitSlop={4} onPress={() => { haptic.tap(); router.push('/woddy'); }}
    style={({ pressed }) => ({ width: 44, height: 44, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.actionPrimarySubtle })}>
    <Image source={woddy.main} style={{ width: 36, height: 36 }} contentFit="contain" accessible={false} />
  </Pressable>;
}

/** One answer: its words (a cited record opens in place), the cards it prepared, a drafted reply, and where it came from. */
function AnswerView({ text, answer }: { text: string; answer: WoddyAnswer }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const sources = citedSources(answer);
  const open = (source: WoddySource) => { const route = recordRoute(source); if (route) { haptic.tap(); router.push(route as Href); } };
  return <View style={{ alignSelf: 'flex-start', width: '100%', gap: theme.space(2) }}>
    <Row gap={2} align="flex-start">
      <Image source={woddy.idle} style={{ width: 28, height: 28 }} contentFit="contain" accessible={false} />
      <View style={{ flex: 1, gap: theme.space(2), padding: theme.space(3), borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceMuted }}>
        {text ? <Text accessibilityRole="text">{withCitations(text, answer.sources).map((part, index) => 'source' in part
          ? <Text key={index} tone={recordRoute(part.source) ? 'action' : 'secondary'} onPress={recordRoute(part.source) ? () => open(part.source) : undefined}
            accessibilityRole={recordRoute(part.source) ? 'link' : undefined}>({part.source.label})</Text>
          : <Text key={index}>{part.text}</Text>)}</Text> : null}
        {answer.draft ? <View style={{ gap: theme.space(1), paddingStart: theme.space(3), borderStartWidth: 2, borderStartColor: theme.colors.borderStrong }}>
          <Text>{answer.draft.text}</Text>
          <Text variant="caption" tone="tertiary">{t('Open the chat to use this draft. Nothing was sent.')}</Text>
        </View> : null}
        {answer.stopped ? <Text variant="caption" tone="tertiary">{t('I stopped there to keep AI credits in check. Ask again to continue.')}</Text> : null}
        {sources.length ? <Row gap={1} wrap>
          <Text variant="caption" tone="tertiary">{t('From')}</Text>
          {sources.map((source) => <Chip key={source.key} label={source.label} tone={recordRoute(source) ? 'action' : 'neutral'} onPress={recordRoute(source) ? () => open(source) : undefined} />)}
        </Row> : null}
      </View>
    </Row>
    {answer.proposals.map((card) => <CardView key={card.id} card={card} />)}
  </View>;
}

/** A value as the card shows it: a time in the workspace's zone, a known label translated, or as it is. */
function useValue() {
  const t = useT();
  const format = useFormat();
  return (value: string | null | undefined, kind?: WoddyPreviewField['format']) => {
    if (!value) return '—';
    if (kind === 'datetime' && Number.isFinite(Date.parse(value))) return format.when(value);
    if (kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return format.day(value);
    return t(value);
  };
}

/**
 * What Woddy prepared, to confirm or cancel: the fields it sets or changes (before → after), every record it
 * applies to (each can be unticked), or the exact text. Nothing changes until Confirm.
 */
function CardView({ card: initial }: { card: WoddyCard }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const value = useValue();
  const decide = useDecideCard();
  const [card, setCard] = useState(initial);
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null);
  const [failure, setFailure] = useState('');
  const items = card.preview.kind === 'targets' ? card.preview.items : [];
  const [kept, setKept] = useState<Set<string>>(() => new Set(items.map((item) => item.id)));
  const [now, setNow] = useState(() => Date.now());
  // An open card turns into "expired" at its time, without a refresh.
  useEffect(() => {
    if (card.status !== 'proposed') return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(Date.parse(card.expiresAt) - Date.now() + 500, 2_000_000_000)));
    return () => clearTimeout(timer);
  }, [card.status, card.expiresAt]);
  const status = busy === 'confirm' ? 'confirmed' : effectiveStatus(card, now);
  const openCard = status === 'proposed';
  const selectable = card.preview.kind === 'targets' && card.preview.selectable && openCard;
  const record = card.record;
  const recordLabel = record ? t(card.target && record.id === card.target.id ? card.target.label : record.label) : '';
  const route = recordRoute(record);
  const run = (decision: 'confirm' | 'reject') => {
    if (busy) return;
    setBusy(decision);
    setFailure('');
    decide.mutate({ card, decision, selection: selectable ? items.filter((item) => kept.has(item.id)).map((item) => item.id) : undefined }, {
      onSuccess: (next) => {
        setCard(next);
        if (decision === 'confirm' && next.status === 'executed') { haptic.approve(); toast.success(t('Done'), 'approve'); }
        else if (next.status === 'failed') haptic.error();
      },
      onError: (error) => { setFailure(isOffline(error) ? t('Woddy needs a connection.') : t(errorMessage(error, t('The action could not be completed.')))); haptic.error(); },
      onSettled: () => setBusy(null),
    });
  };
  const look = CARD_STATUS[status];
  return <Card style={{ gap: theme.space(3) }}>
    <Row style={{ justifyContent: 'space-between' }} align="flex-start">
      <Text variant="label" style={{ flex: 1 }}>{cardTitle(t, card)}</Text>
      <Chip label={t(look.label)} tone={look.tone} />
    </Row>
    {card.preview.kind === 'targets' ? <View style={{ borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.structuralDivider, overflow: 'hidden' }}>
      {card.preview.items.map((item, index) => {
        const ticked = kept.has(item.id);
        const toggle = () => setKept((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; });
        return <Pressable key={item.id} accessibilityRole={selectable ? 'checkbox' : undefined} accessibilityState={selectable ? { checked: ticked } : undefined} disabled={!selectable || !!busy}
          onPress={() => { haptic.tap(); toggle(); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(3), minHeight: 52, paddingHorizontal: theme.space(3), paddingVertical: theme.space(2),
            borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.structuralDivider }}>
          {selectable ? <View style={{ width: 22, height: 22, borderRadius: theme.radius.xs, borderWidth: 2, alignItems: 'center', justifyContent: 'center',
            borderColor: ticked ? theme.colors.actionPrimary : theme.colors.borderStrong, backgroundColor: ticked ? theme.colors.actionPrimary : 'transparent' }}>
            {ticked ? <Check size={14} color={theme.colors.actionOnPrimary} strokeWidth={3} /> : null}
          </View> : null}
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label">{item.label}</Text>
            {item.now ? <Text variant="caption" tone="secondary">{t('Now: {value}', { value: t(item.now) })}</Text> : item.detail ? <Text variant="caption" tone="secondary">{item.detail}</Text> : null}
          </View>
        </Pressable>;
      })}
    </View> : null}
    {card.preview.kind === 'text' ? <View style={{ paddingStart: theme.space(3), borderStartWidth: 2, borderStartColor: theme.colors.borderStrong }}><Text>{card.preview.text}</Text></View> : null}
    {card.preview.fields.length ? <View style={{ borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.structuralDivider, overflow: 'hidden' }}>
      {card.preview.fields.map((field, index) => <Fact key={field.label} first={index === 0} label={t(field.label)}
        value={field.before !== undefined ? <Row gap={1} wrap style={{ justifyContent: 'flex-end' }}>
          <Text variant="caption" tone="tertiary" style={{ textDecorationLine: 'line-through' }}>{value(field.before, field.format)}</Text>
          <View accessibilityLabel={t('changes to')} style={{ transform: [{ scaleX: theme.rtl ? -1 : 1 }] }}><ArrowRight size={12} color={theme.colors.iconSubtle} /></View>
          <Text variant="label">{value(field.after, field.format)}</Text>
        </Row> : value(field.after, field.format)} />)}
    </View> : null}
    {status === 'failed' ? <Banner tone="danger" title={t(card.error ?? t('The action could not be completed.'))} /> : null}
    {card.failures.length && status !== 'failed' ? <Stack gap={1}>{card.failures.map((item) => <Text key={item.id} variant="caption" tone="danger">{t('{record}: {reason}', { record: item.label, reason: t(item.message) })}</Text>)}</Stack> : null}
    {failure ? <Banner tone="danger" title={failure} /> : null}
    {status === 'expired' ? <Text variant="caption" tone="secondary">{t('This suggestion expired. Ask Woddy again.')}</Text>
      : status === 'rejected' ? <Text variant="caption" tone="secondary">{t('Cancelled. Nothing was changed.')}</Text>
        : status === 'executed' && route ? <Button label={t('Open {record}', { record: recordLabel })} onPress={() => router.push(route as Href)} /> : null}
    {openCard || status === 'confirmed' ? <Row gap={2}>
      <View style={{ flex: 1 }}><Button label={t('Cancel')} full size="lg" disabled={!!busy} loading={busy === 'reject'} onPress={() => run('reject')} /></View>
      <View style={{ flex: 1 }}><Button label={t('Confirm')} variant="primary" full size="lg" loading={busy === 'confirm'} disabled={!!busy || (selectable && !kept.size)} onPress={() => run('confirm')} /></View>
    </Row> : null}
  </Card>;
}
