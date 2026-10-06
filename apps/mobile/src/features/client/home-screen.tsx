import { View } from 'react-native';
import { ArrowRight, CalendarCheck, ClipboardCheck, FileSignature, FileText, FolderOpen, Images, MessageCircleReply, Package, PauseCircle, PenLine, Receipt, Sparkles, Sun, Wallet,
  type LucideIcon } from 'lucide-react-native';
import { useT } from '../../core/i18n';
import { digestLines, FEED_KINDS, feedFor, feedTarget, percentOf, signed, waitingFor } from '../../portal/model';
import { usePortalFormat, useProject, useRefreshPortal } from '../../portal/provider';
import type { PortalBudget, PortalFeedKind, PortalProject } from '../../portal/types';
import { Card, Empty, Failure, ListRow, Loading, Progress, Screen, Section } from '../../ui/layout';
import { Row, Text } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { PortalImage, ProjectSwitcher, StateChip, useOpenTarget } from './parts';

const ICONS: Record<PortalFeedKind, LucideIcon> = {
  day: Sun, update: ClipboardCheck, design: Images, presentation: Sparkles, document: FileText, quote: FileSignature, change: PenLine, invoice: Receipt, payment: Wallet,
  reply: MessageCircleReply, handover: Package, choice: CalendarCheck,
};

/**
 * The client's home (plan §5b, the web portal's Home): what changed since they last looked, everything waiting for
 * them, the latest day on site, their budget, then the feed — typed cards, newest first, each opening what it's about.
 */
export function ClientHomeScreen() {
  const t = useT();
  const { project, query } = useProject();
  const refresh = useRefreshPortal();
  if (query.isLoading) return <Screen title={t('Home')} large><Loading shape="cards" count={4} /></Screen>;
  if (query.error && !query.data) return <Screen title={t('Home')} large><Failure message={query.error.message} onRetry={() => void query.refetch()} /></Screen>;
  if (!project) return <Screen title={t('Home')} large onRefresh={() => void refresh()}>
    <Empty icon={FolderOpen} title={t('No projects to show')} detail={t('Your project team hasn\'t shared a project with you yet.')} />
  </Screen>;
  return <HomeContent project={project} refreshing={query.isRefetching} onRefresh={() => void refresh()} />;
}

function HomeContent({ project, refreshing, onRefresh }: { project: PortalProject; refreshing: boolean; onRefresh: () => void }) {
  const t = useT();
  const theme = useTheme();
  const format = usePortalFormat();
  const open = useOpenTarget();
  const percent = percentOf(project);
  const stage = project.stage;
  const subtitle = stage ? stage.name ? t('Stage {number} of {total} · {name}', { number: stage.number, total: stage.total, name: t(stage.name) })
    : t('Stage {number} of {total}', { number: stage.number, total: stage.total }) : project.reference ?? undefined;
  if (project.paused) {
    return <Screen title={project.title} large below={<ProjectSwitcher />} onRefresh={onRefresh} refreshing={refreshing}>
      <Empty icon={PauseCircle} title={t('Your project page is paused')} detail={t('Your project team will let you know when it\'s back. You can still reach them below.')} />
    </Screen>;
  }
  const waiting = waitingFor(project);
  const digest = digestLines(project.digest);
  const day = project.progress?.cards?.[0] ?? null;
  const latest = day ? null : project.latestUpdate;
  const feed = feedFor(project).filter((card) => !(latest && card.kind === 'update' && card.id === latest.id));
  return <Screen title={project.title} subtitle={subtitle} large below={<ProjectSwitcher />} onRefresh={onRefresh} refreshing={refreshing}>
    {percent !== null ? <Progress value={percent / 100} label={t('{percent}% done', { percent })} /> : null}

    {digest.length ? <Card tone="action">
      <Row gap={2}><Sparkles color={theme.colors.actionPrimary} size={16} /><Text variant="label" accessibilityRole="header">{t('Since you last looked')}</Text></Row>
      {digest.map((line) => <View key={line.kind} style={{ gap: 2 }}>
        <Text variant="label">{t(line.label, { count: line.count })}</Text>
        <Text variant="caption" tone="secondary" numberOfLines={2}>{line.titles.map((title) => (line.kind === 'day' ? format.day(title) : title)).join(' · ')}</Text>
      </View>)}
    </Card> : null}

    <Section title={t('Waiting for you')}>
      {waiting.length ? waiting.map((item, index) => <ListRow key={item.id} first={index === 0} icon={item.reply ? MessageCircleReply : ArrowRight} iconTone={item.reply ? 'info' : 'warning'}
        title={t(item.title, { date: format.day(item.due) })} detail={[item.detail, item.due && !item.title.includes('{date}') ? t('by {date}', { date: format.day(item.due) }) : ''].filter(Boolean).join(' · ')}
        onPress={() => open(item.target)} />)
        : <View style={{ padding: theme.space(4) }}><Text tone="secondary">{t('Nothing is waiting for you right now.')}</Text></View>}
    </Section>

    {day ? <Section title={t('Latest from site')}>
      <View style={{ padding: theme.space(4), gap: theme.space(3) }}>
        {day.hero ? <PortalImage kind="photo" id={day.hero.id} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: theme.radius.md }} label={t('Photo')} /> : null}
        <Text variant="overline" tone="secondary">{format.day(day.date)}</Text>
        <Text>{day.summary || (day.noWork ? t('No work on site this day.') : '')}</Text>
        {day.next.length ? <Text variant="caption" tone="secondary">{t('Next')}: {day.next.join(' · ')}</Text> : null}
      </View>
    </Section> : latest ? <Section title={t('Latest update')}>
      <View style={{ padding: theme.space(4), gap: theme.space(2) }}><Text>{latest.text}</Text><Text variant="caption" tone="secondary">{format.day(latest.at)}</Text></View>
    </Section> : null}

    {project.budget ? <BudgetCard budget={project.budget} /> : null}

    {feed.length ? <Section title={t('Latest')}>
      {feed.map((card, index) => {
        const amount = card.kind === 'payment' || card.kind === 'invoice';
        return <ListRow key={`${card.kind}-${card.id}`} first={index === 0} icon={ICONS[card.kind]} title={card.kind === 'day' ? format.day(card.title) : card.title}
          detail={[t(FEED_KINDS[card.kind]), format.day(card.at), card.note && !amount ? card.note : ''].filter(Boolean).join(' · ')}
          trailing={card.status ? <StateChip state={card.status} /> : undefined} onPress={() => open(feedTarget(card))} />;
      })}
    </Section> : null}
  </Screen>;
}

/** R1, the client's budget in short: agreed, approved changes, the forecast final and what still waits for them. */
export function BudgetCard({ budget, full }: { budget: PortalBudget; full?: boolean }) {
  const t = useT();
  const theme = useTheme();
  const format = usePortalFormat();
  const money = (value: string) => format.money(value, budget.currency);
  const line = (label: string, value: string, strong?: boolean) => <Row key={label} style={{ justifyContent: 'space-between' }}>
    <Text variant={strong ? 'label' : 'caption'} tone={strong ? 'default' : 'secondary'} style={{ flex: 1 }}>{label}</Text>
    <Text variant={strong ? 'subheading' : 'label'} style={{ writingDirection: 'ltr' }}>{value}</Text>
  </Row>;
  return <Card>
    <Text variant="label" accessibilityRole="header">{t('Your budget')}</Text>
    <View style={{ gap: theme.space(2) }}>
      {line(t('Agreed value'), money(budget.agreed))}
      {full ? budget.changes.map((change) => line([change.reference, change.title].filter(Boolean).join(' · '), signed(change.amount, money)))
        : budget.changes.length ? line(t('Approved changes'), signed(budget.changesTotal, money)) : null}
      {budget.allowanceOverrun !== '0.00' ? line(t('Allowance spend over what was included'), signed(budget.allowanceOverrun, money)) : null}
      {line(t('Forecast final'), money(budget.forecast), true)}
      {budget.pending.length ? line(budget.pending.length === 1 ? t('1 change waiting for your decision') : t('{count} changes waiting for your decision', { count: budget.pending.length }),
        signed(budget.pendingTotal, money)) : null}
    </View>
  </Card>;
}
