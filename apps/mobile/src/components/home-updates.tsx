import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, View } from 'react-native';
import { Text, tokens, useTheme } from '../design-system';
import { loginTheme } from '../design-system/login-theme';
import { useAuth } from '../auth/provider';
import { loadHomeUpdates, type HomeUpdatesSnapshot, type HrmsDestination } from '../home/updates';
import { Icon } from './icon';

const tints = { lilac: '#f0e8fa', rose: '#f8e7ee', peach: '#fbe8d8' };
export function HomeUpdates({ workspaceId, workspaceName, onOpen }: { workspaceId: string; workspaceName: string; onOpen: (destination: HrmsDestination) => void }) {
  const { client } = useAuth();
  const { direction } = useTheme();
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
        <Text numberOfLines={1} style={styles.workspace}>{workspaceName} · {date}</Text>
        <Text accessibilityRole="header" weight="semibold" style={styles.title}>Updates</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh updates" accessibilityState={{ busy: loading, disabled: loading }}
        disabled={loading} onPress={() => setRevision(value => value + 1)} style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}>
        {loading ? <ActivityIndicator size="small" color={loginTheme.accent} /> : <Text weight="medium" style={styles.refreshLabel}>Refresh</Text>}
      </Pressable>
    </View>
    {items.map(item => <Pressable key={item.id} testID={`home-update-${item.id}`} accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.description}`} accessibilityHint={`Opens HRMS ${item.destination.tab}`}
      onPress={() => onOpen(item.destination)} style={({ pressed }) => [styles.update, row, pressed && styles.pressed]}>
      <View style={[styles.icon, { backgroundColor: tints[item.tone] }]}><Icon name={item.icon} size={19} color={loginTheme.accent} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="semibold" style={styles.updateTitle}>{item.title}</Text>
        <Text style={styles.description}>{item.description}</Text>
      </View>
      <Icon name={direction === 'rtl' ? 'arrow-left' : 'arrow-right'} size={16} color={loginTheme.accent} />
    </Pressable>)}
    {!items.length && <View style={styles.empty}>
      <Text style={styles.updateTitle}>{loading ? 'Checking your latest updates…' : error || snapshot?.partial ? 'Updates are temporarily unavailable' : snapshot?.restricted ? 'Your workspace is ready' : 'You’re up to date'}</Text>
      {!loading && <Text style={styles.description}>{error || snapshot?.partial ? 'Tap Refresh to try again.' : 'Choose a module below to continue.'}</Text>}
    </View>}
    {!!items.length && snapshot?.partial && <Text accessibilityLiveRegion="polite" style={styles.description}>Some updates couldn’t load. Tap Refresh to retry.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 14, marginBottom: 16, gap: 8 },
  heading: { alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  workspace: { fontSize: 11, lineHeight: 16, color: '#726075' },
  title: { fontSize: 20, lineHeight: 27, color: tokens.brand.ink, letterSpacing: -0.4 },
  refresh: { minWidth: 52, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  refreshLabel: { fontSize: 11, lineHeight: 16, color: '#694f7a' },
  update: { minHeight: 64, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 18, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(255,255,255,0.65)', alignItems: 'center', gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  updateTitle: { fontSize: 13, lineHeight: 19, color: tokens.brand.ink },
  description: { fontSize: 11, lineHeight: 16, color: '#726075' },
  empty: { minHeight: 72, padding: 14, gap: 5, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 18 },
  pressed: { opacity: 0.7 },
});
