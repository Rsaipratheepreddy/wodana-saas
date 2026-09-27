import { Linking, Platform, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Check, ClipboardList, FileCheck2, HardHat, ListChecks, MapPin, Navigation, ReceiptText, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import type { ProjectStage } from '../../../../web/lib/project-core/types';
import { errorMessage } from '../../core/api';
import { useFormat } from '../../core/format';
import { haptic } from '../../core/haptics';
import { key, useT } from '../../core/i18n';
import { usePending } from '../../core/outbox';
import { useSession } from '../../core/session';
import { Banner, Card, Failure, Fact, ListRow, Loading, Progress, Screen, Section } from '../../ui/layout';
import { Button, IconBadge, Row, Text } from '../../ui/primitives';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { useBootstrap, useLocations } from '../hrms/api';
import { useProject, useProjectCommand } from './api';

const CHECK_LABEL: Record<string, string> = {
  lead_assigned: key('Project lead assigned'), role_assigned: key('Role assigned'), payment_verified: key('Payment verified'),
  material_list_signed_off: key('Materials signed off'), everything_ordered: key('Everything ordered'), everything_made: key('Everything made'),
  snags_closed: key('All snags closed'), no_critical_snags: key('No critical snag open'), handover_accepted: key('Client accepted the handover'),
};

/** A project: where it stands (stage, progress, handover date), what's next, and the site actions. */
export function ProjectScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const session = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useProject(id);
  const locations = useLocations();
  const bootstrap = useBootstrap();
  const pending = usePending(`project:${id}`);
  if (detail.isLoading) return <Screen back><Loading shape="record" count={4} /></Screen>;
  if (detail.error || !detail.data) return <Screen back><Failure message={errorMessage(detail.error, t('This project could not be loaded.'))} onRetry={() => void detail.refetch()} /></Screen>;
  const { project, stages, next, team, progress } = detail.data;
  const currentIndex = stages.findIndex((stage) => stage.status === 'current');
  const current = stages[currentIndex];
  const site = (locations.data ?? []).find((location) => location.kind === 'site' && location.projectId === project.id);
  const today = format.today();
  const late = project.promiseDate && project.promiseDate < today && project.status === 'active';
  const manager = team.find((entry) => entry.role === 'project_manager')?.member;
  const crews = session.has('hrms') && !!bootstrap.data?.permissions.crews;
  const tiles: Array<{ label: string; icon: LucideIcon; href: Href; show: boolean }> = [
    { label: key('Plan'), icon: ListChecks, href: `/projects/${id}/plan`, show: true },
    { label: key('Daily report'), icon: ClipboardList, href: `/projects/${id}/report`, show: project.status === 'active' || project.status === 'on_hold' },
    { label: key('Crew days'), icon: HardHat, href: `/projects/${id}/crew-days`, show: crews },
    { label: key('Snags'), icon: TriangleAlert, href: `/projects/${id}/snags`, show: true },
    { label: key('Site reports'), icon: FileCheck2, href: `/projects/${id}/reports`, show: true },
    { label: key('Handover'), icon: ShieldCheck, href: `/projects/${id}/handover`, show: true },
    { label: key('Expenses'), icon: ReceiptText, href: `/projects/${id}/expenses`, show: project.status === 'active' },
  ];
  const directions = () => {
    if (!site) return;
    const label = encodeURIComponent(project.name);
    const url = Platform.OS === 'ios' ? `maps:0,0?q=${label}@${site.latitude},${site.longitude}` : `geo:0,0?q=${site.latitude},${site.longitude}(${label})`;
    void Linking.openURL(Platform.OS === 'web' ? `https://www.google.com/maps/search/?api=1&query=${site.latitude},${site.longitude}` : url).catch(() => undefined);
  };
  return <Screen back title={project.name} subtitle={`${project.reference} · ${project.clientName}`} onRefresh={() => void detail.refetch()} refreshing={detail.isRefetching}>
    <Row gap={2} wrap>
      <StatusChip status={project.status} />
      {project.status === 'active' ? <StatusChip status={project.health} /> : null}
      {project.priority !== 'normal' ? <StatusChip status={project.priority} /> : null}
    </Row>
    {project.status === 'on_hold' && project.holdReason ? <Banner tone="warning" title={t('On hold')} detail={project.holdReason} /> : null}
    {pending.length ? <Banner tone="info" title={t('{count} waiting to send', { count: pending.length })} action={{ label: t('View'), onPress: () => router.push('/outbox') }} /> : null}

    <Card style={{ gap: theme.space(3) }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="overline" tone="secondary">{current ? t('Stage {n} of {m}', { n: currentIndex + 1, m: stages.length }) : t('Stages')}</Text>
        {progress !== null ? <Text variant="label" style={{ fontVariant: ['tabular-nums'] }}>{format.percent(progress / 100)}</Text> : null}
      </Row>
      <Text variant="heading">{current?.name ?? (project.status === 'completed' ? t('Completed') : '—')}</Text>
      {progress !== null ? <Progress value={progress / 100} label={t('Progress')} /> : null}
      <StageDots stages={stages} />
      {project.promiseDate ? <Text variant="caption" tone={late ? 'danger' : 'secondary'}>
        {t('Handover {day}', { day: format.day(project.promiseDate) })} · {format.fromToday(project.promiseDate)}
      </Text> : null}
    </Card>

    {next ? <Banner tone="info" icon={Check} title={next.text} detail={next.owner ? t('With {name}', { name: next.owner }) : undefined} /> : null}
    {current ? <StageChecks projectId={project.id} version={project.version} stage={current} /> : null}

    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(2) }}>
      {tiles.filter((tile) => tile.show).map((tile) => <Pressable key={tile.label} accessibilityRole="button" accessibilityLabel={t(tile.label)}
        onPress={() => { haptic.tap(); router.push(tile.href); }}
        style={({ pressed }) => ({ width: '31.5%', flexGrow: 1, minHeight: 88, padding: theme.space(3), gap: theme.space(2), justifyContent: 'space-between', borderRadius: theme.radius.lg,
          borderWidth: 1, borderColor: theme.colors.structuralDivider, backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface })}>
        <IconBadge icon={tile.icon} tone="action" />
        <Text variant="label" numberOfLines={2}>{t(tile.label)}</Text>
      </Pressable>)}
    </View>

    <Section title={t('Details')}>
      {manager ? <Fact first label={t('Project manager')} value={manager.name} /> : null}
      {project.startDate ? <Fact first={!manager} label={t('Started')} value={format.day(project.startDate)} /> : null}
      {project.templateName ? <Fact label={t('Route')} value={project.templateName} /> : null}
      {detail.data.canSeeMoney ? <Fact label={t('Agreed value')} value={format.money(project.total, project.currency)} /> : null}
    </Section>
    {site ? <Section title={t('Site')}>
      <ListRow first icon={MapPin} title={site.name} detail={site.address} trailing={<Button size="sm" label={t('Directions')} icon={Navigation} onPress={directions} />} />
    </Section> : null}
    {team.some((entry) => entry.member) ? <Section title={t('Team')}>
      {team.filter((entry) => entry.member).map((entry, index) => <Fact key={entry.role} first={index === 0} label={entry.label} value={entry.member!.name} />)}
    </Section> : null}
  </Screen>;
}

function StageDots({ stages }: { stages: ProjectStage[] }) {
  const theme = useTheme();
  return <View style={{ flexDirection: 'row', gap: 4 }} accessible={false}>
    {stages.map((stage) => <View key={stage.id} style={{ flex: 1, height: 4, borderRadius: 2,
      backgroundColor: stage.status === 'done' ? theme.colors.success : stage.status === 'current' ? theme.colors.actionPrimary : stage.status === 'skipped' ? theme.colors.border : theme.colors.surfaceMuted }} />)}
  </View>;
}

/** The current stage's checks; the ones people confirm by hand are one tap for whoever works this stage. */
function StageChecks({ projectId, version, stage }: { projectId: string; version: number; stage: ProjectStage }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const command = useProjectCommand(projectId);
  if (!stage.checks.length) return null;
  const confirm = async (checkKey: string, passed: boolean) => {
    try { await command.mutateAsync({ action: passed ? 'unconfirm_check' : 'confirm_check', version, stageId: stage.id, checkKey }); }
    catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  return <Section title={t('To finish this stage')}>
    {stage.checks.map((check, index) => {
      const label = check.label ?? t(CHECK_LABEL[check.kind] ?? check.kind);
      const manual = check.kind === 'confirm' && stage.canWork;
      return <ListRow key={check.key} first={index === 0} icon={check.passed ? Check : undefined} iconTone={check.passed ? 'success' : 'neutral'}
        leading={check.passed ? undefined : <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: theme.colors.borderStrong }} /></View>}
        title={label} detail={check.passed && check.confirmedBy ? t('Confirmed by {name}', { name: check.confirmedBy }) : undefined}
        trailing={manual ? <Button size="sm" label={check.passed ? t('Undo') : t('Confirm')} variant={check.passed ? 'ghost' : 'secondary'} onPress={() => confirm(check.key, check.passed)} loading={command.isPending} /> : undefined} />;
    })}
  </Section>;
}
