import type { ReactNode } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, View } from 'react-native';
import { Text, useTheme } from '../design-system';
import { BrandGradient } from '../design-system/brand-gradient';
import { Icon, type IconName } from '../components/icon';
import { Button as HrmsButton, Card, Notice, StatusBadge, TextField } from '../hrms/ui';
import { crmLabel } from './api';

export { Button, Card, Choice, EmptyState, FieldTrigger, Notice, Sheet, TextField } from '../hrms/ui';

export type CrmTab = 'today' | 'leads' | 'deals' | 'inbox' | 'more';

export function CrmTabs({ value, onChange }: { value: CrmTab; onChange: (tab: CrmTab) => void }) {
  const { colors } = useTheme();
  const tabs: { id: CrmTab; label: string; icon: IconName }[] = [
    { id: 'today', label: 'Today', icon: 'home' },
    { id: 'leads', label: 'Leads', icon: 'profile' },
    { id: 'deals', label: 'Deals', icon: 'crm' },
    { id: 'inbox', label: 'Inbox', icon: 'inbox' },
    { id: 'more', label: 'More', icon: 'more' },
  ];
  return <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: 4, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 3 }}>
    {tabs.map(tab => <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: value === tab.id }}
      accessibilityLabel={tab.label} onPress={() => onChange(tab.id)}
      style={({ pressed }) => ({ flex: 1, minHeight: 54, paddingVertical: 7, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 3, overflow: 'hidden',
        backgroundColor: pressed && value !== tab.id ? colors.surfacePressed : 'transparent',
        borderWidth: 1, borderColor: value === tab.id ? 'rgba(105,79,122,0.16)' : 'transparent' })}>
      {value === tab.id ? <BrandGradient /> : null}
      <Icon name={tab.icon} size={18} color={value === tab.id ? '#2f232d' : colors.iconSubtle} filled={value === tab.id && tab.id === 'today'} />
      <Text size="xs" weight="semibold" numberOfLines={1} style={{ color: value === tab.id ? colors.text : colors.textSecondary, fontSize: 11 }}>{tab.label}</Text>
    </Pressable>)}
  </View>;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <TextField label="Search" accessibilityLabel={placeholder} value={value} onChangeText={onChange} placeholder={placeholder}
    autoCapitalize="none" autoCorrect={false} returnKeyType="search" />;
}

export function Loading({ label = 'Loading CRM…' }: { label?: string }) {
  const { colors } = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 24 }}>
    <ActivityIndicator color={colors.actionPrimary} /><Text size="sm" tone="textSecondary">{label}</Text>
  </View>;
}

export function ResourceState({ loading, error, empty, emptyTitle, children }: {
  loading: boolean; error: string; empty?: boolean; emptyTitle?: string; children?: ReactNode;
}) {
  return <>
    {error ? <Notice error>{error}</Notice> : null}
    {loading ? <Loading /> : null}
    {!loading && !error && empty ? <Card><Text weight="semibold">{emptyTitle ?? 'Nothing here yet'}</Text><Text size="sm" tone="textSecondary">Pull down to refresh or use the create action.</Text></Card> : null}
    {children}
  </>;
}

export function Metric({ value, label, accent = false }: { value: string | number; label: string; accent?: boolean }) {
  const { colors } = useTheme();
  return <View style={{ flexGrow: 1, flexBasis: '46%', minHeight: 84, padding: 14, borderRadius: 18, overflow: 'hidden',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
    {accent ? <BrandGradient /> : null}
    <Text size="xl" weight="bold" style={{ color: colors.text }}>{value}</Text>
    <Text size="xs" style={{ color: accent ? '#5f5360' : colors.textSecondary }}>{label}</Text>
  </View>;
}

export function RecordCard({ title, subtitle, status, meta, unread, phone, onPress, children }: {
  title: string; subtitle?: string; status?: string; meta?: string; unread?: number; phone?: string; onPress?: () => void; children?: ReactNode;
}) {
  const { colors, direction } = useTheme();
  const content = <View style={{ flexDirection: direction === 'rtl' ? 'row-reverse' : 'row', alignItems: 'flex-start', gap: 12 }}>
      <View style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.actionPrimarySubtle }}>
        <Text weight="bold" style={{ color: colors.actionPrimary }}>{title.trim().slice(0, 1).toUpperCase() || 'C'}</Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: direction === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 }}>
          <Text weight="semibold" numberOfLines={1} style={{ flex: 1 }}>{title}</Text>
          {unread ? <View style={{ minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.actionPrimary }}><Text size="xs" weight="bold" style={{ color: colors.actionOnPrimary }}>{unread}</Text></View> : null}
        </View>
        {subtitle ? <Text size="sm" tone="textSecondary" numberOfLines={2}>{subtitle}</Text> : null}
        <View style={{ flexDirection: direction === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 5 }}>
          {status ? <StatusBadge status={String(status)} label={crmLabel(status)} /> : null}
          {meta ? <Text size="xs" tone="textTertiary">{meta}</Text> : null}
        </View>
      </View>
      {onPress ? <Icon name="chevron-right" size={18} color={colors.iconSubtle} /> : null}
    </View>;
  return <Card>
    <View style={{ flexDirection: direction === 'rtl' ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 }}>
      {onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title}`} onPress={onPress}
        style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.72 : 1 })}>{content}</Pressable> : <View style={{ flex: 1 }}>{content}</View>}
      {phone ? <Pressable accessibilityRole="button" accessibilityLabel={`Call ${title} at ${phone}`} onPress={() => openPhone(phone)}
        style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
          backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted, borderWidth: 1, borderColor: colors.border })}>
        <Icon name="phone" size={19} color={colors.actionPrimary} />
      </Pressable> : null}
    </View>{children}
  </Card>;
}

export function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
    <View style={{ flex: 1, gap: 3 }}><Text accessibilityRole="header" size="xl" weight="bold">{title}</Text>
      {subtitle ? <Text size="sm" tone="textSecondary">{subtitle}</Text> : null}</View>{action}
  </View>;
}

export function phoneUrl(phone: string) {
  const clean = phone.trim().replace(/[^\d+*#,;]/g, '');
  return clean ? `tel:${clean}` : '';
}

async function openPhone(phone: string) {
  const url = phoneUrl(phone);
  if (!url) return;
  try {
    if (!await Linking.canOpenURL(url)) throw new Error('unsupported');
    await Linking.openURL(url);
  } catch {
    Alert.alert('Calling is unavailable', `Your device could not open the phone app for ${phone}.`);
  }
}

export function CallButton({ phone, label = 'Call' }: { phone: string; label?: string }) {
  const { colors } = useTheme();
  const url = phoneUrl(phone);
  return <HrmsButton label={label} variant="secondary" disabled={!url}
    accessibilityLabel={`${label} ${phone}`} startIcon={<Icon name="phone" size={18} color={colors.actionPrimary} />}
    onPress={() => { if (url) void openPhone(phone); }} />;
}

export function HorizontalFilters({ items, value, onChange }: { items: { id: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  const { colors } = useTheme();
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
    {items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: value === item.id }} onPress={() => onChange(item.id)}
      style={({ pressed }) => ({ minHeight: 38, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 19,
        backgroundColor: value === item.id ? colors.actionPrimary : pressed ? colors.surfacePressed : colors.surface,
        borderWidth: 1, borderColor: value === item.id ? colors.actionPrimary : colors.border })}>
      <Text size="xs" weight="semibold" style={{ color: value === item.id ? colors.actionOnPrimary : colors.textSecondary }}>{item.label}</Text>
    </Pressable>)}
  </ScrollView>;
}
