import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme } from '../design-system';
import { useAuth } from '../auth/provider';
import { loadHomeUpdates, type HomeUpdatesSnapshot, type HrmsDestination } from '../home/updates';
import { Icon } from './icon';

export function HomeUpdates({ workspaceId, workspaceName, onOpen }: { workspaceId: string; workspaceName: string; onOpen: (destination: HrmsDestination) => void }) {
  const { client } = useAuth();
  const { direction, colors } = useTheme();
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<HomeUpdatesSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    loadHomeUpdates(path => client.api(path), workspaceId).then(value => {
      if (active) setSnapshot(value);
    }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, workspaceId, revision]);
  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active' && previous !== 'active') setRevision(value => value + 1);
      previous = next;
    });
    return () => subscription.remove();
  }, []);
  const date = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: snapshot?.timezone }).format(new Date());
  const row = { flexDirection: direction === 'rtl' ? 'row-reverse' as const : 'row' as const };
  const items = error ? [] : snapshot?.items ?? [];
  return <View testID="home-updates" style={styles.section}>
    <View style={[styles.heading, row]}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text size="xs" tone="textSecondary" numberOfLines={1}>{workspaceName} · {date}</Text>
        <Text accessibilityRole="header" size="xl" weight="semibold">For you today</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh updates" accessibilityState={{ busy: loading, disabled: loading }}
        disabled={loading} onPress={() => setRevision(value => value + 1)} style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}>
        {loading ? <ActivityIndicator size="small" color={colors.actionPrimary} /> : <Text size="xs" weight="medium" style={{ color: colors.link }}>Refresh</Text>}
      </Pressable>
    </View>
    {items.map(item => <Pressable key={item.id} testID={`home-update-${item.id}`} accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.description}`} accessibilityHint={`Opens HRMS ${item.destination.tab}`}
      onPress={() => onOpen(item.destination)} style={({ pressed }) => [styles.update, row,
        { backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: colors.border }, pressed && styles.pressed]}>
      <View style={[styles.icon, { backgroundColor: colors.actionPrimarySubtle }]}><Icon name={item.icon} size={19} color={colors.actionPrimary} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text size="sm" weight="semibold">{item.title}</Text>
        <Text size="xs" tone="textSecondary">{item.description}</Text>
      </View>
      <Icon name={direction === 'rtl' ? 'arrow-left' : 'arrow-right'} size={16} color={colors.iconSubtle} />
    </Pressable>)}
    {!items.length && <View style={[styles.empty, { backgroundColor: colors.surfaceMuted }]}>
      <Text size="sm" weight="medium">{loading ? 'Checking your day…' : error || snapshot?.partial ? 'Today’s updates are temporarily unavailable' : snapshot?.restricted ? 'Your workspace is ready' : 'You’re up to date'}</Text>
      {!loading && <Text size="xs" tone="textSecondary">{error || snapshot?.partial ? 'Tap Refresh to try again.' : 'Choose a module below to continue.'}</Text>}
    </View>}
    {!!items.length && snapshot?.partial && <Text accessibilityLiveRegion="polite" size="xs" tone="textSecondary">Some updates couldn’t load. Tap Refresh to retry.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 14, marginBottom: 16, gap: 8 },
  heading: { alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  refresh: { minWidth: 52, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  update: { minHeight: 64, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center', gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  empty: { minHeight: 72, padding: 14, gap: 5, justifyContent: 'center', borderRadius: 10 },
  pressed: { opacity: 0.7 },
});
