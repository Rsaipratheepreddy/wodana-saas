import { Pressable, View } from 'react-native';
import { AlertTriangle, CalendarClock, Check, CircleDot, Eye } from 'lucide-react-native';
import type { DayCard } from '../../../../web/lib/site/types';
import { useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { PhotoGrid } from '../../ui/photos';
import { Chip, Row, Stack, Text } from '../../ui/primitives';
import { StatusChip } from '../../ui/status';
import { useTheme } from '../../ui/theme';
import { sitePhotoPath } from './api';
import { openIssues, workLines } from './day-card-model';

/**
 * A project's day on site on the phone: who reported, the photos (tap one to see it full size), the work done with
 * its stage, the open issues, the crew and what's next. Tapping the card opens its report.
 */
export function DayCardView({ card, projectId, onOpen }: { card: DayCard; projectId: string; onOpen?: () => void }) {
  const t = useT();
  const theme = useTheme();
  const format = useFormat();
  const lines = workLines(card);
  const issues = openIssues(card);
  const noWork = card.reports.filter((report) => report.noWorkReason).map((report) => report.noWorkReason);
  const severity = (value: string) => (value === 'critical' ? { label: t('Critical'), tone: 'danger' as const } : value === 'major' ? { label: t('Major'), tone: 'warning' as const }
    : { label: t('Minor'), tone: 'neutral' as const });
  return <Pressable onPress={onOpen} disabled={!onOpen} accessibilityRole="button" accessibilityLabel={t('Site day {date}', { date: format.longDay(card.date) })}
    style={({ pressed }) => ({ padding: theme.space(4), gap: theme.space(3), opacity: pressed ? 0.85 : 1 })}>
    <Row gap={2} wrap>
      <StatusChip status={card.status} />
      {card.clientVisible ? <Chip label={t('Client sees this')} tone="success" icon={Eye} /> : null}
      {card.reports.some((report) => report.late) ? <Chip label={t('Late')} tone="warning" /> : null}
      <Text variant="caption" tone="secondary" style={{ flexShrink: 1 }} numberOfLines={1}>{card.reports.map((report) => report.authorName).join(', ')}</Text>
    </Row>
    {card.photos.length ? <PhotoGrid photos={card.photos.slice(0, 8).map((photo) => ({ key: photo.id, path: sitePhotoPath(projectId, photo.id), label: photo.area ?? undefined }))}
      columns={4} max={card.photos.length} /> : null}
    {noWork.length ? <Text variant="body" tone="secondary">{noWork.map((reason) => t('No work: {reason}', { reason })).join(' · ')}</Text> : null}
    {lines.length ? <Stack gap={1}>
      <Text variant="overline" tone="secondary">{t('Work done')}</Text>
      {lines.map((line) => <Row key={line.id} gap={2} align="flex-start">
        {line.done ? <Check size={15} color={theme.colors.success} /> : <CircleDot size={14} color={theme.colors.info} />}
        <Text variant="body" style={{ flex: 1 }}>{line.quantity ? t('{item}: {quantity} installed', { item: line.title, quantity: `${format.number(line.quantity.value, 2)} ${line.quantity.unit}`.trim() }) : line.title}</Text>
        {line.progress !== null || line.stage ? <Text variant="caption" tone="tertiary">{[line.progress !== null ? `${line.progress}%` : null, line.stage].filter(Boolean).join(' · ')}</Text> : null}
      </Row>)}
    </Stack> : null}
    {issues.length ? <Stack gap={1}>
      <Text variant="overline" tone="secondary">{t('Issues')}</Text>
      {issues.map((issue) => <Row key={issue.id} gap={2} align="flex-start">
        <AlertTriangle size={14} color={issue.severity === 'critical' ? theme.colors.danger : theme.colors.warning} />
        <View style={{ flex: 1, gap: theme.space(0.5) }}>
          <Text variant="body">{issue.description}</Text>
          <Text variant="caption" tone={issue.overdue ? 'danger' : 'tertiary'}>{[severity(issue.severity).label, issue.ownerName ?? t('No owner'),
            issue.dueOn ? t('Due {date}', { date: format.day(issue.dueOn) }) : null].filter(Boolean).join(' · ')}</Text>
        </View>
      </Row>)}
    </Stack> : null}
    {card.crew.length ? <Text variant="caption" tone="secondary">{[...card.crew.map((row) => t('{trade} {people}', { trade: row.trade, people: row.people })),
      t('{count} on site', { count: card.people })].join(' · ')}</Text> : null}
    {card.next.length ? <Stack gap={1}>
      <Text variant="overline" tone="secondary">{t('Next')}</Text>
      {card.next.map((item) => <Row key={item.id} gap={2}><CalendarClock size={14} color={theme.colors.textTertiary} /><Text variant="body" style={{ flex: 1 }}>{item.title}</Text></Row>)}
    </Stack> : null}
  </Pressable>;
}
