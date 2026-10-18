import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { FolderKanban } from 'lucide-react-native';
import type { ProjectRow } from '../../../../web/lib/project-core/types';
import { errorMessage } from '../../core/api';
import { useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { FilterChips, SearchField } from '../../ui/fields';
import { Empty, ListRow, ListScreen } from '../../ui/layout';
import { Chip, Row, Text } from '../../ui/primitives';
import { StatusChip } from '../../ui/status';
import { useTheme } from '../../ui/theme';
import { useProjects } from './api';

type Filter = 'open' | 'on_hold' | 'closed';
const matches = (row: ProjectRow, filter: Filter) => (filter === 'open' ? row.status === 'active' : filter === 'on_hold' ? row.status === 'on_hold' : ['completed', 'cancelled', 'archived'].includes(row.status));

/** The projects I'm on (all of them for people who run projects), running ones first. */
export function ProjectsScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const theme = useTheme();
  const projects = useProjects();
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (projects.data?.projects ?? []).filter((row) => matches(row, filter))
      .filter((row) => !needle || `${row.name} ${row.reference} ${row.clientName} ${row.lead ?? ''}`.toLowerCase().includes(needle));
  }, [projects.data, filter, query]);
  const count = (value: Filter) => (projects.data?.projects ?? []).filter((row) => matches(row, value)).length;
  const today = format.today();
  return <ListScreen title={t('Projects')} back items={rows} keyExtractor={(row) => row.id}
    toolbar={<View style={{ gap: theme.space(3) }}>
      <SearchField value={query} onChange={setQuery} placeholder={t('Search projects')} />
      <FilterChips value={filter} onChange={setFilter} options={[
        { value: 'open', label: `${t('Running')} · ${count('open')}` }, { value: 'on_hold', label: `${t('On hold')} · ${count('on_hold')}` }, { value: 'closed', label: t('Closed') },
      ]} />
    </View>}
    loading={projects.isLoading} error={projects.error ? errorMessage(projects.error, t('Projects could not be loaded.')) : null} onRetry={() => void projects.refetch()}
    onRefresh={() => void projects.refetch()} refreshing={projects.isRefetching}
    empty={<Empty icon={FolderKanban} title={query ? t('Nothing matches') : t('No projects here')} />}
    renderItem={(row, _, first) => <ListRow first={first} title={row.name} onPress={() => router.push(`/projects/${row.id}`)}
      detail={`${row.reference} · ${row.clientName}`}
      meta={<Row gap={2} wrap style={{ marginTop: 4 }}>
        {row.stage ? <Text variant="caption" tone="secondary">{t('Stage {n} of {m}', { n: row.stage.position, m: row.stage.count })} · {row.stage.name}</Text> : null}
        {row.promiseDate ? <Text variant="caption" tone={row.promiseDate < today && row.status === 'active' ? 'danger' : 'tertiary'}>{t('Handover {day}', { day: format.day(row.promiseDate) })}</Text> : null}
        {row.status === 'active' && row.attention?.late ? <Chip label={t('{count} late', { count: row.attention.late })} tone="danger" /> : null}
        {row.status === 'active' && row.attention?.blocked ? <Chip label={t('{count} blocked', { count: row.attention.blocked })} tone="warning" /> : null}
      </Row>}
      trailing={row.status === 'active' ? <StatusChip status={row.health} /> : <StatusChip status={row.status} />} />} />;
}

