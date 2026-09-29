import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ClipboardList, Image as ImageIcon, Plus, Star } from 'lucide-react-native';
import type { SiteReport } from '../../../../web/lib/site/types';
import { errorMessage } from '../../core/api';
import { useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { ReasonSheet } from '../../ui/dialogs';
import { TextField } from '../../ui/fields';
import { Banner, Empty, Fact, ListRow, ListScreen, Section } from '../../ui/layout';
import { AuthImage, PhotoGrid } from '../../ui/photos';
import { Button, Chip, Row, Stack, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { sitePhotoPath, useSite, useSiteCommand } from './api';

/** The day's state as one chip: sent to the client wins over approved. */
const statusOf = (report: SiteReport) => (report.delivery === 'sent' ? 'sent' : report.status);
/** The day's lead photo, else its first one. */
const leadPhoto = (report: SiteReport) => report.heroPhotoId ?? report.photos[0]?.id ?? null;

/** The project's daily progress, newest first; the project manager reviews, approves & sends, or sends back here. */
export function ReportsScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const { id: projectId, report: linked } = useLocalSearchParams<{ id: string; report?: string }>();
  const site = useSite(projectId);
  const [open, setOpen] = useState<SiteReport | null>(null);
  const state = site.data;
  // A notice or Approvals opens the day it's about.
  useEffect(() => { if (linked && state && !open) setOpen(state.reports.find((report) => report.id === linked) ?? null); }, [linked, state, open]);
  const people = (report: SiteReport) => report.workforce.reduce((sum, entry) => sum + entry.people, 0);
  const current = open ? state?.reports.find((report) => report.id === open.id) ?? open : null;
  return <>
    <ListScreen title={t('Daily progress')} back items={state?.reports} keyExtractor={(report) => report.id} groupBy={(report) => format.weekday(report.reportDate)}
      loading={site.isLoading} error={site.error ? errorMessage(site.error, t('Reports could not be loaded.')) : null} onRetry={() => void site.refetch()}
      onRefresh={() => void site.refetch()} refreshing={site.isRefetching}
      toolbar={state && state.reports.some((report) => report.status === 'submitted' && report.authorId !== state.me) && state.canApprove
        ? <Banner tone="warning" title={t('{count} to review', { count: state.reports.filter((report) => report.status === 'submitted' && report.authorId !== state.me).length })} /> : undefined}
      empty={<Empty icon={ClipboardList} title={t('No reports yet')} />}
      renderItem={(report, _, first) => <ListRow first={first} title={report.authorName} onPress={() => setOpen(report)}
        leading={leadPhoto(report) ? <AuthImage path={sitePhotoPath(projectId, leadPhoto(report)!)} accessibilityLabel={t('Lead photo')}
          style={{ width: 52, height: 52, borderRadius: theme.radius.md }} /> : undefined}
        detail={report.clientSummary || (report.noWorkReason ? t('No work · {reason}', { reason: report.noWorkReason }) : [t('{count} on site', { count: people(report) }), report.lines.length ? t('{count} lines installed', { count: report.lines.length }) : null].filter(Boolean).join(' · '))}
        meta={report.late || report.safety !== 'none' || report.forecast !== 'none' ? <Row gap={1} style={{ marginTop: 4 }}>
          {report.late ? <Chip label={t('Late')} tone="warning" /> : null}
          {report.safety !== 'none' ? <Chip label={report.safety === 'incident' ? t('Incident') : t('Observation')} tone={report.safety === 'incident' ? 'danger' : 'warning'} /> : null}
          {report.forecast !== 'none' ? <StatusChip status={report.forecast === 'blocked' ? 'blocked' : 'at_risk'} /> : null}
        </Row> : undefined}
        trailing={<StatusChip status={statusOf(report)} />} />}
      footer={state?.canReport ? <Button label={t('Today’s report')} icon={Plus} variant="primary" size="lg" full onPress={() => router.push(`/projects/${projectId}/report`)} /> : undefined} />
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
