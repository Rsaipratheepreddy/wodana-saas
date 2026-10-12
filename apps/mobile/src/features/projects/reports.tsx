import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarX, ClipboardList, Image as ImageIcon, Plus, Star } from 'lucide-react-native';
import type { DayCard, SiteReport } from '../../../../web/lib/site/types';
import { errorMessage } from '../../core/api';
import { useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { ReasonSheet } from '../../ui/dialogs';
import { TextField } from '../../ui/fields';
import { Banner, Empty, Fact, ListRow, ListScreen, Section } from '../../ui/layout';
import { PhotoGrid } from '../../ui/photos';
import { Button, Chip, Row, Stack, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { sitePhotoPath, useSite, useSiteCommand } from './api';
import { DayCardView } from './day-card';
import { feedItems, reportToOpen } from './day-card-model';

/** The day's state as one chip: sent to the client wins over approved. */
const statusOf = (report: SiteReport) => (report.delivery === 'sent' ? 'sent' : report.status);

/** The project's daily progress, newest first; the project manager reviews, approves & sends, or sends back here. */
export function ReportsScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const { id: projectId, report: linked } = useLocalSearchParams<{ id: string; report?: string }>();
  const site = useSite(projectId);
  const [open, setOpen] = useState<SiteReport | null>(null);
  const state = site.data;
  // A notice or Approvals opens the day it's about.
  useEffect(() => { if (linked && state && !open) setOpen(state.reports.find((report) => report.id === linked) ?? null); }, [linked, state, open]);
  const current = open ? state?.reports.find((report) => report.id === open.id) ?? open : null;
  // A day's card opens its report: mine to continue (the form), any other to read or review (the sheet).
  const openDay = (card: DayCard) => {
    const chosen = state ? reportToOpen(card, state.me) : null;
    const full = chosen ? state?.reports.find((report) => report.id === chosen.id) : null;
    if (!chosen || !state) return;
    if (chosen.authorId === state.me && (chosen.status === 'draft' || chosen.status === 'returned') && state.canReport) router.push(`/projects/${projectId}/report?date=${card.date}`);
    else if (full) setOpen(full);
  };
  const toReview = state ? state.reports.filter((report) => report.status === 'submitted' && report.authorId !== state.me).length : 0;
  return <>
    <ListScreen title={t('Daily progress')} back items={state ? feedItems(state.days) : undefined} keyExtractor={(item) => item.key} groupBy={(item) => format.weekday(item.date)}
      loading={site.isLoading} error={site.error ? errorMessage(site.error, t('Reports could not be loaded.')) : null} onRetry={() => void site.refetch()}
      onRefresh={() => void site.refetch()} refreshing={site.isRefetching}
      toolbar={state && toReview && state.canApprove ? <Banner tone="warning" title={t('{count} to review', { count: toReview })} /> : undefined}
      empty={<Empty icon={ClipboardList} title={t('No daily progress yet')} action={state?.canReport ? { label: t('Add today’s report'), onPress: () => router.push(`/projects/${projectId}/report`) } : undefined} />}
      renderItem={(item, _, first) => item.card ? <DayCardView card={item.card} projectId={projectId} onOpen={() => openDay(item.card!)} />
        : <ListRow first={first} icon={CalendarX} iconTone="danger" title={t('No report')}
          trailing={state?.canReport ? <Button size="sm" variant="ghost" label={t('Add report')} onPress={() => router.push(`/projects/${projectId}/report?date=${item.date}`)} /> : undefined} />}
      footer={state?.canReport ? <Button label={t('Add today’s report')} icon={Plus} variant="primary" size="lg" full onPress={() => router.push(`/projects/${projectId}/report`)} /> : undefined} />
    <ReportSheet projectId={projectId} report={current} onClose={() => setOpen(null)} />
  </>;
}

/**
 * One day for the project manager: what the client will read (edited here), the photos that go (and the lead one),
 * and what the supervisor reported; then Approve & send, approve and keep it internal, or send it back.
 */
function ReportSheet({ projectId, report, onClose }: { projectId: string; report: SiteReport | null; onClose: () => void }) {
  const t = useT();
  const format = useFormat();
  const toast = useToast();
  const site = useSite(projectId);
  const command = useSiteCommand(projectId);
  const [returning, setReturning] = useState(false);
  const [summary, setSummary] = useState('');
  useEffect(() => { setSummary(report?.clientSummary ?? ''); }, [report?.id, report?.clientSummary]);
  const state = site.data;
  const reviewable = Boolean(state?.canApprove && report && report.authorId !== state.me && report.delivery !== 'sent' && (report.status === 'submitted' || report.status === 'approved'));
  const run = async (action: string, input: Record<string, unknown> = {}, done?: string) => {
    if (!report) return false;
    try {
      await command.mutateAsync({ action, reportId: report.id, version: report.version, ...input });
      if (done) { toast.success(done); onClose(); }
      return true;
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); return false; }
  };
  const lineTitle = (id: string) => state?.lines.find((line) => line.id === id)?.title;
  const picked = report?.photos.filter((photo) => photo.forClient).length ?? 0;
  const footer = !report || !reviewable ? undefined : report.status === 'submitted' ? <Stack gap={2}>
    <Button label={t('Approve & send')} variant="primary" size="lg" full loading={command.isPending} onPress={() => void run('approve_send', {}, t('Sent to the client'))} />
    <Row gap={2}>
      <View style={{ flex: 1 }}><Button label={t('Approve without sending')} variant="secondary" full onPress={() => void run('approve_hold', {}, t('Approved'))} /></View>
      <Button label={t('Send back')} variant="ghost" onPress={() => setReturning(true)} />
    </Row>
  </Stack> : <Button label={t('Send to the client')} variant="primary" size="lg" full loading={command.isPending} onPress={() => void run('send', {}, t('Sent to the client'))} />;
  return <>
    <Sheet open={!!report && !returning} onClose={onClose} title={report?.authorName} subtitle={report ? format.longDay(report.reportDate) : undefined} full footer={footer}>
      {report ? <Stack gap={3}>
        <Row gap={2} wrap>
          <StatusChip status={statusOf(report)} />
          {report.late ? <Chip label={t('Late')} tone="warning" /> : null}
          {report.delivery === 'internal' ? <Chip label={t('Kept internal')} /> : null}
        </Row>
        {report.decisionNote ? <Banner tone="warning" title={t('Sent back')} detail={report.decisionNote} /> : null}
        {reviewable ? <Section title={t('What the client reads')}>
          <TextField value={summary} onChangeText={setSummary} multiline maxLength={1200} placeholder={t('A few words for the client')} />
          {summary.trim() !== (report.clientSummary ?? '').trim() ? <Button label={t('Save the words')} variant="secondary" disabled={!summary.trim()}
            onPress={() => void run('review', { summary: summary.trim() })} /> : null}
        </Section> : report.clientSummary ? <Section title={report.delivery === 'sent' ? t('What the client got') : t('What the client reads')}>
          <Text variant="body">{report.clientSummary}</Text>
        </Section> : null}
        {report.photos.length ? <Section title={t('Photos for the client')} action={<Text variant="caption" tone="secondary">{t('{count} of {limit}', { count: picked, limit: 6 })}</Text>}>
          {report.photos.map((photo, index) => <ListRow key={photo.id} first={index === 0} icon={photo.id === report.heroPhotoId ? Star : ImageIcon}
            iconTone={photo.forClient ? 'action' : 'neutral'} title={t('Photo {number}', { number: index + 1 })}
            detail={[photo.forClient ? t('Goes to the client') : t('Stays inside'), photo.id === report.heroPhotoId ? t('Lead photo') : null].filter(Boolean).join(' · ')}
            onPress={reviewable ? () => void run('review', { photos: [{ id: photo.id, forClient: !photo.forClient }] }) : undefined}
            onLongPress={reviewable ? () => void run('review', { heroPhotoId: photo.id }) : undefined} />)}
        </Section> : null}
        {report.photos.length ? <PhotoGrid photos={report.photos.map((photo) => ({ key: photo.id, path: sitePhotoPath(projectId, photo.id) }))} /> : null}
        {(report.tasks ?? []).length ? <Section title={t('Today’s work')}>
          {(report.tasks ?? []).map((task, index) => <Fact key={task.id} first={index === 0} label={task.title} value={task.progress === 100 ? t('Done') : `${task.progress}%`} />)}
        </Section> : null}
        {(report.next ?? []).length ? <Section title={t('Tomorrow')}>
          {(report.next ?? []).map((item, index) => <Fact key={item.id} first={index === 0} label={item.title} value="" />)}
        </Section> : null}
        {report.noWorkReason ? <Banner tone="neutral" title={t('No work')} detail={report.noWorkReason} /> : null}
        {report.workforce.length ? <Section title={t('Who worked')}>
          {report.workforce.map((entry, index) => <Fact key={entry.trade} first={index === 0} label={entry.trade}
            value={entry.hours ? t('{people} · {hours} h', { people: entry.people, hours: Number(entry.hours) }) : String(entry.people)} />)}
        </Section> : null}
        {(report.issues ?? []).length ? <Section title={t('Issues')}>
          {(report.issues ?? []).map((issue, index) => <Fact key={issue.id} first={index === 0} label={issue.description}
            value={[issue.severity === 'critical' ? t('Critical') : issue.severity === 'major' ? t('Major') : t('Minor'), issue.workItemNumber ? `#${issue.workItemNumber}` : null].filter(Boolean).join(' · ')} />)}
        </Section> : null}
        {report.lines.length ? <Section title={t('Installed')}>
          {report.lines.map((line, index) => <Fact key={line.id} first={index === 0} label={line.title || lineTitle(line.boqLineId) || ''} value={`${format.number(line.installed, 4)} ${line.unit}`} />)}
        </Section> : null}
        <Section>
          {report.weather ? <Fact first label={t('Weather')} value={report.weather} /> : null}
          <Fact first={!report.weather} label={t('Safety')} value={report.safety === 'none' ? t('All clear') : `${report.safety === 'incident' ? t('Incident') : t('Observation')} · ${report.safetyNote}`} />
          <Fact label={t('Outlook')} value={report.forecast === 'none' ? t('On track') : `${report.forecast === 'blocked' ? t('Blocked') : t('At risk')} · ${report.impact}`} />
          {report.forecast !== 'none' && report.recoveryOwnerName ? <Fact label={t('Recovery')} value={`${report.recoveryOwnerName}${report.recoveryOn ? ` · ${format.day(report.recoveryOn)}` : ''}`} /> : null}
          {report.notes ? <Fact label={t('Notes for the team')} value={report.notes} /> : null}
        </Section>
        {!report.photos.length && !report.noWorkReason ? <Text variant="caption" tone="tertiary">{t('No photos')}</Text> : null}
      </Stack> : null}
    </Sheet>
    <ReasonSheet open={returning} onClose={() => setReturning(false)} title={t('Send this report back?')} label={t('What to change')} action={t('Send back')}
      onSubmit={async (note) => {
        if (!report) return;
        try { await command.mutateAsync({ action: 'return', reportId: report.id, version: report.version, note: note.slice(0, 500) }); toast.success(t('Sent back')); onClose(); }
        catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); throw error; }
      }} />
  </>;
}
