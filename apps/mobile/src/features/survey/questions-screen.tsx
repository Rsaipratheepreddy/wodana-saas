import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { ListChecks } from 'lucide-react-native';
import { errorMessage } from '../../core/api';
import { useT } from '../../core/i18n';
import { useOutbox, usePending } from '../../core/outbox';
import { SegmentedControl, TextField } from '../../ui/fields';
import { Banner, Empty, Failure, Loading, Screen, Section } from '../../ui/layout';
import { Button, Chip, Row, Text } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { useToast } from '../../ui/toast';
import { useCase, useDesignJourney } from './api';
import {
  answerable, askedGroups, CHECK_LABEL, CHECK_STATUSES, changedAnswers, draftsFrom, isAnswered, requiredLeft,
  type AnswerDraft, type CheckStatus, type SiteChecklistItem,
} from './questions-model';
import type { SiteAnswersPayload } from './send';

/**
 * The site visit's questions on the phone: the firm's published list as this job carries it (the general questions,
 * then the checklists that apply), optional unless the firm marked them required. Answers are saved on the phone and
 * sent when there is a connection, against the visit as it is then.
 */
export function SiteQuestionsScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const outbox = useOutbox();
  const { caseId } = useLocalSearchParams<{ caseId: string }>();
  const detail = useCase(caseId);
  const journey = useDesignJourney(caseId);
  const pending = usePending(`case:${caseId}`).filter((item) => item.kind === 'survey.answers');
  const view = journey.data;
  const groups = useMemo(() => (view ? askedGroups(view) : []), [view]);
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const loaded = useRef(false);
  // The saved answers fill the form once; a refresh never overwrites what the person is typing.
  useEffect(() => { if (view?.checklist && !loaded.current) { loaded.current = true; setDrafts(draftsFrom(view.checklist)); } }, [view]);
  if (journey.isLoading) return <Screen back title={t('Questions')}><Loading shape="form" count={5} /></Screen>;
  if (!view) return <Screen back title={t('Questions')}><Failure message={errorMessage(journey.error, t('Could not load'))} onRetry={() => void journey.refetch()} /></Screen>;
  const checklist = view.checklist ?? [];
  const changes = changedAnswers(drafts, checklist);
  const left = requiredLeft(groups, drafts);
  const asked = groups.flatMap((group) => group.questions);
  const answered = asked.filter((item) => isAnswered(item, drafts[item.key])).length;
  const editable = asked.some((item) => answerable(view, item));
  const set = (item: SiteChecklistItem, patch: Partial<AnswerDraft>) =>
    setDrafts((current) => ({ ...current, [item.key]: { answer: current[item.key]?.answer ?? '', status: current[item.key]?.status ?? null, ...patch } }));
  const save = async () => {
    if (!changes.length) return;
    const payload: SiteAnswersPayload = { caseId, answers: changes };
    try {
      await outbox.enqueue({ id: Crypto.randomUUID(), kind: 'survey.answers', title: `${t('Questions')} · ${detail.data?.customerName ?? detail.data?.title ?? ''}`, scope: `case:${caseId}`,
        payload: payload as unknown as Record<string, unknown> });
      toast.success(t('Saved'));
      router.back();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  return <Screen back title={t('Questions')} subtitle={detail.data?.customerName ?? detail.data?.title} keyboard
    footer={editable ? <Button label={t('Save')} variant="primary" size="lg" full disabled={!changes.length} onPress={() => void save()} /> : undefined}>
    {asked.length ? <Row gap={2} wrap>
      <Chip label={t('{answered} of {total} answered', { answered, total: asked.length })} />
      {left ? <Chip tone="warning" label={t('{count} required', { count: left })} /> : null}
    </Row> : null}
    {pending.length ? <Banner tone="info" title={t('{count} waiting to send', { count: pending.length })} action={{ label: t('View'), onPress: () => router.push('/outbox') }} /> : null}
    {!asked.length ? <Empty icon={ListChecks} title={t('Nothing here yet')} /> : groups.map((group) => <Section key={group.id} title={group.title ?? undefined}>
      {group.questions.map((item, index) => {
        const draft = drafts[item.key] ?? { answer: '', status: null };
        const open = answerable(view, item);
        return <View key={item.key} style={{ padding: theme.space(4), gap: theme.space(2), borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.structuralDivider }}>
          <Row gap={2} align="flex-start">
            <Text variant="label" style={{ flex: 1 }}>{item.question}</Text>
            {item.required ? <Chip label={t('Required')} /> : null}
          </Row>
          {item.kind === 'check' ? <SegmentedControl<CheckStatus | ''> value={draft.status ?? ''} onChange={(status) => { if (open && status) set(item, { status }); }}
            options={CHECK_STATUSES.map((status) => ({ value: status, label: t(CHECK_LABEL[status]) }))} /> : null}
          <TextField value={draft.answer} onChangeText={(answer) => set(item, { answer })} multiline maxLength={4000} editable={open}
            placeholder={item.kind === 'check' ? t('Note') : t('Answer')} accessibilityLabel={item.question} />
          {item.answeredByName ? <Text variant="caption" tone="tertiary">{t('Answered by {name}', { name: item.answeredByName })}</Text> : null}
        </View>;
      })}
    </Section>)}
  </Screen>;
}
