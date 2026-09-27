import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ClipboardList, Plus } from 'lucide-react-native';
import type { SiteReport } from '../../../../web/lib/site/types';
import { errorMessage } from '../../core/api';
import { useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { ReasonSheet } from '../../ui/dialogs';
import { Banner, Empty, Fact, ListRow, ListScreen, Section } from '../../ui/layout';
import { PhotoGrid } from '../../ui/photos';
import { Button, Chip, Row, Stack, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { sitePhotoPath, useSite, useSiteCommand } from './api';

/** The project's daily reports, newest first; the project manager approves or sends them back here. */
export function ReportsScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const site = useSite(projectId);
  const [open, setOpen] = useState<SiteReport | null>(null);
  const state = site.data;
  const people = (report: SiteReport) => report.workforce.reduce((sum, entry) => sum + entry.people, 0);
  return <>
    <ListScreen title={t('Site reports')} back items={state?.reports} keyExtractor={(report) => report.id} groupBy={(report) => format.weekday(report.reportDate)}
      loading={site.isLoading} error={site.error ? errorMessage(site.error, t('Reports could not be loaded.')) : null} onRetry={() => void site.refetch()}
      onRefresh={() => void site.refetch()} refreshing={site.isRefetching}
      toolbar={state && state.reports.some((report) => report.status === 'submitted') && state.canApprove
        ? <Banner tone="warning" title={t('{count} to approve', { count: state.reports.filter((report) => report.status === 'submitted' && report.authorId !== state.me).length })} /> : undefined}
      empty={<Empty icon={ClipboardList} title={t('No reports yet')} />}
      renderItem={(report, _, first) => <ListRow first={first} title={report.authorName} onPress={() => setOpen(report)}
        detail={report.noWorkReason ? t('No work · {reason}', { reason: report.noWorkReason }) : [t('{count} on site', { count: people(report) }), report.lines.length ? t('{count} lines installed', { count: report.lines.length }) : null].filter(Boolean).join(' · ')}
        meta={report.safety !== 'none' || report.forecast !== 'none' ? <Row gap={1} style={{ marginTop: 4 }}>
          {report.safety !== 'none' ? <Chip label={report.safety === 'incident' ? t('Incident') : t('Observation')} tone={report.safety === 'incident' ? 'danger' : 'warning'} /> : null}
          {report.forecast !== 'none' ? <StatusChip status={report.forecast === 'blocked' ? 'blocked' : 'at_risk'} /> : null}
        </Row> : undefined}
        trailing={<StatusChip status={report.status} />} />}
      footer={state?.canReport ? <Button label={t('Today’s report')} icon={Plus} variant="primary" size="lg" full onPress={() => router.push(`/projects/${projectId}/report`)} /> : undefined} />
    <ReportSheet projectId={projectId} report={open} onClose={() => setOpen(null)} />
  </>;
}

function ReportSheet({ projectId, report, onClose }: { projectId: string; report: SiteReport | null; onClose: () => void }) {
  const t = useT();
  const format = useFormat();
  const toast = useToast();
  const site = useSite(projectId);
  const command = useSiteCommand(projectId);
  const [returning, setReturning] = useState(false);
  const state = site.data;
  const decide = state?.canApprove && report?.status === 'submitted' && report.authorId !== state.me;
  const approve = async () => {
    if (!report) return;
    try { await command.mutateAsync({ action: 'approve', reportId: report.id, version: report.version }); toast.success(t('Approved')); onClose(); }
    catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  const lineTitle = (id: string) => state?.lines.find((line) => line.id === id)?.title;
  return <>
    <Sheet open={!!report && !returning} onClose={onClose} title={report?.authorName} subtitle={report ? format.longDay(report.reportDate) : undefined} full
      footer={decide ? <Row gap={2}>
        <Button label={t('Send back')} variant="secondary" size="lg" onPress={() => setReturning(true)} />
        <View style={{ flex: 1 }}><Button label={t('Approve')} variant="primary" size="lg" full loading={command.isPending} onPress={approve} /></View>
      </Row> : undefined}>
      {report ? <Stack gap={3}>
        <StatusChip status={report.status} />
        {report.decisionNote ? <Banner tone="warning" title={t('Sent back')} detail={report.decisionNote} /> : null}
        {report.noWorkReason ? <Banner tone="neutral" title={t('No work')} detail={report.noWorkReason} /> : null}
        {report.workforce.length ? <Section title={t('Who worked')}>
          {report.workforce.map((entry, index) => <Fact key={entry.trade} first={index === 0} label={entry.trade} value={String(entry.people)} />)}
        </Section> : null}
        {report.lines.length ? <Section title={t('Installed')}>
          {report.lines.map((line, index) => <Fact key={line.id} first={index === 0} label={line.title || lineTitle(line.boqLineId) || ''} value={`${format.number(line.installed, 4)} ${line.unit}`} />)}
        </Section> : null}
        <Section>
          {report.weather ? <Fact first label={t('Weather')} value={report.weather} /> : null}
          <Fact first={!report.weather} label={t('Safety')} value={report.safety === 'none' ? t('All clear') : `${report.safety === 'incident' ? t('Incident') : t('Observation')} · ${report.safetyNote}`} />
          <Fact label={t('Outlook')} value={report.forecast === 'none' ? t('On track') : `${report.forecast === 'blocked' ? t('Blocked') : t('At risk')} · ${report.impact}`} />
          {report.forecast !== 'none' && report.recoveryOwnerName ? <Fact label={t('Recovery')} value={`${report.recoveryOwnerName}${report.recoveryOn ? ` · ${format.day(report.recoveryOn)}` : ''}`} /> : null}
          {report.notes ? <Fact label={t('Notes')} value={report.notes} /> : null}
        </Section>
        {report.photos.length ? <PhotoGrid photos={report.photos.map((photo) => ({ key: photo.id, path: sitePhotoPath(projectId, photo.id) }))} /> : null}
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
