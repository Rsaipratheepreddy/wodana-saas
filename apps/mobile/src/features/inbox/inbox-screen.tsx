import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Bell, CheckCheck, ClipboardList, Factory, FolderKanban, Inbox, PackageCheck, PhoneCall, Ruler, ShoppingCart, Users, Wallet, type LucideIcon } from 'lucide-react-native';
import { appRouteFor } from '../../core/deep-links';
import { errorMessage } from '../../core/api';
import { addDays, useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { FilterChips } from '../../ui/fields';
import { Empty, ListRow, ListScreen } from '../../ui/layout';
import { IconButton, Text } from '../../ui/primitives';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { useInbox, useMarkAllRead, useMarkRead, type InboxNotification } from './api';

const iconFor = (eventType: string): LucideIcon => {
  const area = eventType.split('.')[0];
  if (area === 'crm') return PhoneCall;
  if (area === 'hrms') return Users;
  if (area.startsWith('project') || area === 'site') return FolderKanban;
  if (area === 'purchasing' || area === 'payables') return ShoppingCart;
  if (area === 'inventory' || area === 'receiving') return PackageCheck;
  if (area === 'factory') return Factory;
  if (area.startsWith('pre') || area === 'design' || area === 'quotation') return Ruler;
  if (area === 'finance' || area === 'petty_cash' || area === 'receivables') return Wallet;
  if (area === 'jobs') return ClipboardList;
  return Bell;
};

/** Everything that needs me, newest first; opening one opens its record and marks it read. */
export function InboxScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const toast = useToast();
  const inbox = useInbox();
  const read = useMarkRead();
  const readAll = useMarkAllRead();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const items = useMemo(() => (inbox.data ?? []).filter((item) => filter === 'all' || !item.readAt), [inbox.data, filter]);
  const today = format.today();
  const group = (item: InboxNotification) => {
    const day = format.dayOf(item.createdAt);
    return day === today ? t('Today') : day >= addDays(today, -6) ? t('This week') : t('Earlier');
  };
  const openItem = (item: InboxNotification) => {
    if (!item.readAt) read.mutate(item.id);
    const route = appRouteFor(item.deepLink);
    if (route) router.push(route as Href);
    else toast.show(t('Open this on the web to see it.'));
  };

  if (!inbox.enabled) {
    return <ListScreen large title={t('Inbox')} items={[]} keyExtractor={() => ''} renderItem={() => <View />}
      empty={<Empty icon={Inbox} title={t('Notifications aren’t on for you')} detail={t('Ask your administrator for access to notifications.')} />} />;
  }
  return <ListScreen large title={t('Inbox')}
    action={inbox.unread ? <IconButton icon={CheckCheck} label={t('Mark all read')} onPress={() => readAll.mutate()} /> : undefined}
    toolbar={<FilterChips value={filter} onChange={setFilter} options={[{ value: 'all', label: t('All') }, { value: 'unread', label: inbox.unread ? t('Unread · {count}', { count: inbox.unread }) : t('Unread') }]} />}
    items={items} keyExtractor={(item) => item.id} groupBy={group}
    loading={inbox.isLoading} error={inbox.error ? errorMessage(inbox.error, t('The inbox could not be loaded.')) : null} onRetry={() => void inbox.refetch()}
    onRefresh={() => void inbox.refetch()} refreshing={inbox.isRefetching}
    empty={<Empty icon={Inbox} title={filter === 'unread' ? t('All caught up') : t('No notifications yet')} />}
    renderItem={(item, _, first) => <ListRow first={first} icon={iconFor(item.eventType)} iconTone={item.readAt ? 'neutral' : 'action'}
      title={item.subject || item.body} onPress={() => openItem(item)}
      detail={item.subject ? item.body : undefined}
      meta={<Text variant="caption" tone="tertiary">{format.ago(item.createdAt)}</Text>}
      trailing={!item.readAt ? <View accessibilityLabel={t('Unread')} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.actionPrimary }} /> : <View />} />} />;
}
