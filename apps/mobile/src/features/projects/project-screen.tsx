import { Linking, Platform, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Check, CheckCircle2, ClipboardList, FileCheck2, FilePen, HardHat, ListChecks, MapPin, Navigation, ReceiptText, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import type { Blocker, ProjectOverview, ProjectStage } from '../../../../web/lib/project-core/types';
import { appRouteFor } from '../../core/deep-links';
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
import { useProject, useProjectCommand, useProjectOverview } from './api';
import { blockerLabel, stageLateBy } from './overview-model';

const CHECK_LABEL: Record<string, string> = {
  lead_assigned: key('Project lead assigned'), role_assigned: key('Role assigned'), payment_verified: key('Payment verified'),
  material_list_signed_off: key('Materials signed off'), everything_ordered: key('Everything ordered'), everything_made: key('Everything made'),
  snags_closed: key('All snags closed'), no_critical_snags: key('No critical snag open'), handover_accepted: key('Client accepted the handover'),
  drawings_uploaded: key('Technical drawings uploaded'), drawings_site_checked: key('Technical site check passed'), drawings_client_approved: key('Client approved the drawings'),
  factory_slot_booked: key('Factory slot booked'),
  installation_scheduled: key('Installation scheduled'), goods_delivered: key('Everything delivered'), installation_done: key('Installation signed off'),
};

/**
 * A project: where it stands (stage, progress, handover date), what's next and what holds it up, its money at a glance
 * for the people who may see it (the server decides), and the site actions.
 */
export function ProjectScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const session = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useProject(id);
  const overview = useProjectOverview(id);
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
    { label: key('Raise a change'), icon: FilePen, href: `/projects/${id}/change-new`, show: project.status === 'active' || project.status === 'on_hold' },
    { label: key('Daily progress'), icon: FileCheck2, href: `/projects/${id}/reports`, show: true },
    { label: key('Handover'), icon: ShieldCheck, href: `/projects/${id}/handover`, show: true },
    { label: key('Expenses'), icon: ReceiptText, href: `/projects/${id}/expenses`, show: project.status === 'active' },
  ];
  const directions = () => {
    if (!site) return;
    const label = encodeURIComponent(project.name);
    const url = Platform.OS === 'ios' ? `maps:0,0?q=${label}@${site.latitude},${site.longitude}` : `geo:0,0?q=${site.latitude},${site.longitude}(${label})`;
    void Linking.openURL(Platform.OS === 'web' ? `https://www.google.com/maps/search/?api=1&query=${site.latitude},${site.longitude}` : url).catch(() => undefined);
  };
  const glance = overview.data;
  const lateBy = current && glance ? stageLateBy(glance.stagePlan[current.id], glance.today) : 0;
  const running = project.status === 'active' || project.status === 'on_hold';
  return <Screen back title={project.name} subtitle={`${project.reference} · ${project.clientName}`} onRefresh={() => { void detail.refetch(); void overview.refetch(); }} refreshing={detail.isRefetching}>
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

    {next ? <Banner tone={lateBy ? 'warning' : 'info'} icon={Check} title={t(next.text)}
      detail={[next.owner ? t('With {name}', { name: next.owner }) : null, lateBy ? t('{stage} is {count} days past its plan', { stage: t(next.stage), count: lateBy }) : null].filter(Boolean).join(' · ') || undefined} /> : null}
    {running ? <HoldUps projectId={project.id} overview={glance} loading={overview.isLoading} failed={!!overview.error} onRetry={() => void overview.refetch()} /> : null}
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
      {detail.data.canSeeMoney && !glance?.money ? <Fact label={t('Agreed value')} value={format.money(project.total, project.currency)} /> : null}
    </Section>
    {glance?.money ? <MoneyGlance money={glance.money} /> : null}
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

/** What holds the project up, each opening its list; a calm line when nothing does. */
function HoldUps({ projectId, overview, loading, failed, onRetry }: { projectId: string; overview: ProjectOverview | undefined; loading: boolean; failed: boolean; onRetry: () => void }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  if (loading) return null;
  if (failed || !overview) return <Banner tone="warning" title={t("The overview didn't load.")} action={{ label: t('Try again'), onPress: onRetry }} />;
  if (!overview.blockers.length) return <Banner tone="success" icon={CheckCircle2} title={t('Nothing is holding the project up.')} />;
  const items = (blocker: Blocker) => (blocker.key === 'reports_missing' ? blocker.items.map((day) => format.day(day)) : blocker.items);
  return <Section title={t('What holds it up')}>
    {overview.blockers.map((blocker, index) => {
      const route = appRouteFor(blocker.href);
      const opens = route && route !== `/projects/${projectId}`;
      return <ListRow key={blocker.key} first={index === 0}
        leading={<View style={{ minWidth: 36, height: 36, paddingHorizontal: theme.space(2), borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center',
          backgroundColor: blocker.key === 'funds_short' || blocker.key === 'critical_snags' ? theme.colors.dangerSubtle : theme.colors.warningSubtle }}>
          <Text variant="label" tone={blocker.key === 'funds_short' || blocker.key === 'critical_snags' ? 'danger' : 'warning'} style={{ fontVariant: ['tabular-nums'] }}>{blocker.count}</Text>
        </View>}
        title={t(blockerLabel(blocker.key, blocker.count))} detail={items(blocker).join(' · ') || undefined}
        onPress={opens ? () => router.push(route as Href) : undefined} />;
    })}
  </Section>;
}

/** The client side at a glance (agreed, received, still due, next payment) and the cash in hand, for people who see money. */
function MoneyGlance({ money }: { money: NonNullable<ProjectOverview['money']> }) {
  const t = useT();
  const format = useFormat();
  const short = money.available !== null && Number(money.available) < 0;
  return <Section title={t('Money')}>
    <Fact first label={t('Agreed')} value={format.money(money.agreed, money.currency)} />
    <Fact label={t('Received')} value={format.money(money.received, money.currency)} />
    <Fact label={t('Still due')} value={format.money(money.due, money.currency)} />
    {money.next ? <Fact label={t('Next payment')} value={[money.next.title, format.money(money.next.amount, money.currency), money.next.dueDate ? format.day(money.next.dueDate) : null].filter(Boolean).join(' · ')} /> : null}
    {money.available !== null && money.costCurrency ? <Fact label={t('Cash in hand')}
      value={<Text variant="label" tone={short ? 'danger' : 'default'}>{format.money(money.available, money.costCurrency)}</Text>} /> : null}
  </Section>;
}
