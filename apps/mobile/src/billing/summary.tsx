import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Surface, Text, useTheme } from '../design-system';
import { useAuth } from '../auth/provider';
import { loadMobileBilling, type MobileBillingData } from './api';

function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
}

function money(value: string, currency: string) {
  try { return new Intl.NumberFormat('en-AE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value)); }
  catch { return `${currency} ${value}`; }
}

export function BillingSummary({ workspaceId }: { workspaceId: string }) {
  const { client } = useAuth();
  const { colors } = useTheme();
  const [data, setData] = useState<MobileBillingData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true); setError('');
    void loadMobileBilling(client, workspaceId).then(setData)
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Billing could not be loaded.'))
      .finally(() => setLoading(false));
  }, [client, workspaceId]);
  useEffect(load, [load]);

  if (loading && !data) return <Surface muted style={styles.panel}><Text size="sm" tone="textSecondary">Loading plan and usage…</Text></Surface>;
  if (error && !data) return <Surface muted style={styles.panel}>
    <Text size="sm" tone="danger">{error}</Text><Button label="Try again" variant="secondary" onPress={load}/>
  </Surface>;
  if (!data) return null;
  const contract = 'version' in data.contract ? data.contract : null;
  const allocation = 'version' in data.organizationAllocation ? data.organizationAllocation : null;

  return <Surface style={[styles.panel, { borderColor: colors.border }]} accessibilityLabel="Plan and billing">
    <View style={styles.heading}><Text size="sm" weight="semibold">Plan & billing</Text>
      <Text size="2xs" tone="textSecondary">{humanize(data.accessPolicy.state)}</Text></View>
    <Text size="xs" tone={data.accessPolicy.warning ? 'danger' : 'textSecondary'}>{data.accessPolicy.message}</Text>
    {contract && allocation ? <>
      <View style={[styles.row, { borderTopColor: colors.border }]}>
        <View><Text size="2xs" tone="textSecondary">PLAN</Text><Text size="sm" weight="semibold">{humanize(contract.planCode)}</Text></View>
        <View><Text size="2xs" tone="textSecondary">ALLOCATION</Text><Text size="sm" weight="semibold">{money(allocation.allocatedAmount, contract.currency)}</Text></View>
      </View>
      <View style={[styles.row, { borderTopColor: colors.border }]}>
        <View><Text size="2xs" tone="textSecondary">SEATS</Text><Text size="sm" weight="semibold">{data.usage.reservedSeats} / {allocation.seatLimit}</Text></View>
        <View><Text size="2xs" tone="textSecondary">PROJECTS</Text><Text size="sm" weight="semibold">{data.usage.projects} / {allocation.projectLimit}</Text></View>
      </View>
    </> : <Text size="xs" tone="textSecondary">Billing setup is incomplete. Existing workspace access is unchanged.</Text>}
  </Surface>;
}

const styles = StyleSheet.create({
  panel: { width: '100%', maxWidth: 520, marginTop: 20, padding: 16, gap: 12, borderWidth: 1, borderRadius: 14 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 12, gap: 20 },
});
