import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text, useTheme } from '../design-system';
import { useAuth } from '../auth/provider';
import { Button, Card, EmptyState, Notice, StatusBadge } from '../hrms/ui';
import { NoteCard } from '../pre-project/ui';
import {
  disableNotifications,
  enableNotifications,
  loadNotificationInbox,
  openNotification,
  syncExistingNotificationRegistration,
  type InboxNotification,
  type MobileDestination,
  type NotificationSettings,
} from '../notifications/native-notifications';

function timestamp(value: string) {
  if (!Number.isFinite(Date.parse(value))) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function NotificationsScreen({ workspaceId, onOpen }: { workspaceId: string; onOpen: (destination: MobileDestination) => void }) {
  const { client } = useAuth();
  const { colors } = useTheme();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [supportMessage, setSupportMessage] = useState('');
  const refresh = useCallback(async () => {
    setError('');
    try {
      const [nextSettings, nextItems] = await Promise.all([
        syncExistingNotificationRegistration(client, workspaceId),
        loadNotificationInbox(client, workspaceId),
      ]);
      setSettings(nextSettings.settings); setSupportMessage(nextSettings.supportMessage ?? ''); setItems(nextItems);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Updates could not be loaded.'); }
    finally { setLoading(false); }
  }, [client, workspaceId]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function togglePush() {
    setBusy(true); setError(''); setSupportMessage('');
    try {
      if (settings?.pushEnabled) setSettings(await disableNotifications(client, workspaceId));
      else {
        const result = await enableNotifications(client, workspaceId);
        setSettings(result.settings); setSupportMessage(result.supportMessage ?? '');
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Notification settings could not be changed.'); }
    finally { setBusy(false); }
  }

  async function open(item: InboxNotification) {
    setError('');
    try {
      const result = await openNotification(client, workspaceId, item.id);
      setItems(current => current.map(row => row.id === item.id ? { ...row, readAt: result.readAt } : row));
      onOpen(result.destination);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'This update could not be opened.'); }
  }

  return <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
    refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} tintColor={colors.actionPrimary} colors={[colors.actionPrimary]} />}
    contentContainerStyle={{ width: '100%', maxWidth: 720, alignSelf: 'center', gap: 16, paddingBottom: 44 }}>
    <Card tinted>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, gap: 5 }}><Text weight="semibold">Push notifications</Text>
          <Text size="sm" tone="textSecondary">Assigned work, client replies and approvals. In-app updates always remain available.</Text></View>
        {settings ? <StatusBadge label={settings.pushEnabled ? 'On' : 'Off'} status={settings.pushEnabled ? 'complete' : 'pending'} /> : null}
      </View>
      <Button label={settings?.pushEnabled ? 'Turn off on this device' : 'Turn on notifications'} loading={busy} onPress={() => void togglePush()} />
      {supportMessage ? <Text size="xs" tone="textSecondary">{supportMessage}</Text> : null}
    </Card>
    {error ? <Notice error>{error}</Notice> : null}
    <View style={{ gap: 5 }}><Text accessibilityRole="header" size="lg" weight="semibold">Updates</Text>
      <Text size="sm" tone="textSecondary">{settings?.unreadCount ?? items.filter(item => !item.readAt).length} unread</Text></View>
    {loading ? <Text tone="textSecondary">Loading updates…</Text> : null}
    {!loading && !items.length ? <EmptyState title="No updates yet" description="Assignments, replies and approvals will appear here." icon="bell" /> : null}
    {items.map(item => <NoteCard key={item.id} title={item.subject || 'Wodana update'}
      meta={`${item.readAt ? 'Read' : 'New'} · ${timestamp(item.createdAt)}`} note={item.body} onPress={() => void open(item)} />)}
  </ScrollView>;
}
