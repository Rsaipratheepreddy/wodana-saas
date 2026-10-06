import { useEffect, useRef, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, CircleEllipsis, House, MessagesSquare, Palette, Wallet, type LucideIcon } from 'lucide-react-native';
import { haptic } from '../../core/haptics';
import { key, useT } from '../../core/i18n';
import { designWaiting } from '../../portal/model';
import { portalViewKey, usePortal, usePortalView, useProject } from '../../portal/provider';
import { ClientPushContext, useClientPush } from '../../portal/push';
import { Button, IconBadge, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { useTheme } from '../../ui/theme';
import { ConfirmNameScreen } from './sign-in-screen';

const TABS: Record<string, { label: string; icon: LucideIcon }> = {
  index: { label: key('Home'), icon: House },
  design: { label: key('Design'), icon: Palette },
  payments: { label: key('Payments'), icon: Wallet },
  messages: { label: key('Messages'), icon: MessagesSquare },
  more: { label: key('More'), icon: CircleEllipsis },
};

/** Home · Design · Payments · Messages · More, with what waits for the client counted on its tab. */
export function ClientTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const theme = useTheme();
  const t = useT();
  const { project } = useProject();
  const counts: Record<string, number> = {
    design: project ? designWaiting(project) : 0,
    payments: project?.next.filter((step) => step.kind === 'invoice').length ?? 0,
    messages: (project?.messages?.unread ?? 0) + (project?.decisions?.requests.filter((item) => item.canDecide).length ?? 0),
  };
  return <View accessibilityRole="tablist" style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: Math.max(insets.bottom, theme.space(2)), paddingTop: theme.space(1.5),
    paddingHorizontal: theme.space(2), backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.structuralDivider }}>
    {state.routes.map((route, index) => {
      const tab = TABS[route.name];
      if (!tab) return null;
      const focused = state.index === index;
      const Icon = tab.icon;
      const badge = counts[route.name] ?? 0;
      const colour = focused ? theme.colors.actionPrimary : theme.colors.textTertiary;
      return <Pressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={badge ? `${t(tab.label)}, ${badge}` : t(tab.label)}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) { haptic.tap(); navigation.navigate(route.name, route.params); }
        }}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, gap: 2 }}>
        <View>
          <Icon color={colour} size={24} strokeWidth={focused ? 2.2 : 1.8} />
          {badge ? <View style={{ position: 'absolute', top: -4, end: -10, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: theme.colors.dangerSolid,
            alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: theme.colors.surface }}>
            <Text style={{ color: theme.colors.onDanger, fontSize: 10, lineHeight: 12, fontFamily: theme.font.semibold }}>{badge > 99 ? '99+' : badge}</Text>
          </View> : null}
        </View>
        <Text style={{ fontSize: theme.size['2xs'], lineHeight: 14, fontFamily: focused ? theme.font.semibold : theme.font.medium, color: colour }}>{t(tab.label)}</Text>
      </Pressable>;
    })}
  </View>;
}

const SECTIONS: Record<string, string> = { payments: '/portal/payments', design: '/portal/design', decisions: '/portal/design', messages: '/portal/messages', documents: '/portal/documents',
  changes: '/portal/changes', warranty: '/portal/warranty', progress: '/portal' };

/**
 * The signed-in client's frame: their name confirmed first (the first time), the push question in the app's own words,
 * and a push notice opening the section it is about. Another client's or portal's cached view is never shown.
 */
export function ClientShell({ children }: { children: ReactNode }) {
  const { state } = usePortal();
  const view = usePortalView();
  const queryClient = useQueryClient();
  const router = useRouter();
  const push = useClientPush();
  const slug = state.status === 'signedIn' ? state.slug : null;
  const previous = useRef(slug);
  useEffect(() => {
    if (previous.current !== slug) queryClient.removeQueries({ queryKey: portalViewKey(previous.current) });
    previous.current = slug;
  }, [slug, queryClient]);
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const data = lastResponse?.notification.request.content.data as { section?: unknown; portal?: unknown } | undefined;
    const section = typeof data?.section === 'string' ? data.section : null;
    if (!section || (typeof data?.portal === 'string' && data.portal !== slug)) return;
    const route = SECTIONS[section];
    if (route) router.navigate(route as Href);
    void queryClient.invalidateQueries({ queryKey: portalViewKey(slug) });
  }, [lastResponse, router, slug, queryClient]);
  if (state.status === 'signedIn' && state.needsName) return <ConfirmNameScreen name={view.data?.contact.name ?? ''} />;
  return <ClientPushContext.Provider value={push}>
    {children}
    <PushQuestion open={push.asking} onAllow={() => void push.allow()} onLater={() => void push.later()} />
  </ClientPushContext.Provider>;
}

function PushQuestion({ open, onAllow, onLater }: { open: boolean; onAllow: () => void; onLater: () => void }) {
  const t = useT();
  const theme = useTheme();
  return <Sheet open={open} onClose={onLater}
    footer={<View style={{ gap: theme.space(2) }}>
      <Button label={t('Turn on notifications')} variant="primary" size="lg" full onPress={onAllow} testID="push-allow" />
      <Button label={t('Not now')} variant="ghost" full onPress={onLater} />
    </View>}>
    <View style={{ alignItems: 'center', gap: theme.space(3), paddingVertical: theme.space(4) }}>
      <IconBadge icon={Bell} tone="action" size={56} />
      <Text variant="heading" accessibilityRole="header" style={{ textAlign: 'center' }}>{t('Hear about your project')}</Text>
      <Text tone="secondary" style={{ textAlign: 'center', maxWidth: 320 }}>{t('Decisions waiting for you, payments due and replies from your team arrive as notifications. You can turn them off any time.')}</Text>
    </View>
  </Sheet>;
}
