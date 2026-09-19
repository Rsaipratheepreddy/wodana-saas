import { PreProjectScreen } from './pre-project-screen';
import { HrmsScreen } from './hrms-screen';
import { CrmScreen } from './crm-screen';
import { ProjectsScreen } from './projects-screen';
import { NotificationsScreen } from './notifications-screen';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Image, Keyboard, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Surface, Text, useTheme } from '../design-system';
import { useAuth } from '../auth/provider';
import { BottomNavigation, homeTabs, type HomeTab } from '../components/bottom-navigation';
import { brandMarkSource } from '../components/brand-logo';
import { Icon } from '../components/icon';
import { visibleHomeModules, type HomeModule } from '../components/home-modules';
import { HomeUpdates } from '../components/home-updates';
import type { HrmsDestination } from '../home/updates';
import { revokeCurrentNotificationDevice, watchNotificationOpens, type MobileDestination } from '../notifications/native-notifications';
import { BillingSummary } from '../billing/summary';

export function HomeScreen({ onSignOut }: { onSignOut: () => void }) {
  const insets = useSafeAreaInsets();
  const { reducedMotion, direction, colors, mode } = useTheme();
  const { client, state } = useAuth();
  const profile = state.status === 'signedIn' ? state.profile : null;
  const workspace = state.status === 'signedIn' ? state.profile.memberships.find(item => item.workspaceId === state.workspaceId) : null;
  const availableModules = useMemo(() => visibleHomeModules(workspace?.allowedModules), [workspace?.allowedModules]);
  const logoUrl = workspace?.workspaceLogoUrl?.startsWith('https://') ? workspace.workspaceLogoUrl
    : workspace?.workspaceLogoUrl?.startsWith('/') && process.env.EXPO_PUBLIC_WORKSPACE_ORIGIN
      ? `${process.env.EXPO_PUBLIC_WORKSPACE_ORIGIN.replace(/\/$/, '')}${workspace.workspaceLogoUrl}` : null;
  const initials = profile?.displayName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'W';
  const firstName = profile?.displayName.trim().split(/\s+/)[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const [activeTab, setActiveTab] = useState<HomeTab>('home');
  const [module, setModule] = useState<HomeModule | null>(null);
  const [hrmsDestination, setHrmsDestination] = useState<HrmsDestination>({ tab: 'attendance' });
  const [notificationDestination, setNotificationDestination] = useState<MobileDestination | null>(null);
  const entrance = useRef(new Animated.Value(1)).current;
  const currentTab = homeTabs.find(tab => tab.id === activeTab) ?? homeTabs[0];
  const onHome = currentTab.id === 'home' && !module;
  const title = module?.label ?? currentTab.label;
  const changeTab = (tab: HomeTab) => { Keyboard.dismiss(); setModule(null); setActiveTab(tab); };
  const openModule = (item: HomeModule) => { Keyboard.dismiss(); setHrmsDestination({ tab: 'attendance' }); setNotificationDestination(null); setModule(item); };
  const openUpdate = (destination: HrmsDestination) => {
    Keyboard.dismiss();
    setHrmsDestination(destination);
    setModule(availableModules.find(item => item.id === 'hrms') ?? null);
  };
  const openNotificationDestination = useCallback((destination: MobileDestination) => {
    Keyboard.dismiss();
    const moduleId = destination.module === 'pre-project' ? 'pre-project' : destination.module;
    const next = availableModules.find(item => item.id === moduleId)
      ?? availableModules.find(item => item.id === 'crm');
    setNotificationDestination(next?.id === moduleId ? destination : { module: 'crm', screen: 'inbox' });
    setActiveTab('home');
    setModule(next ?? null);
  }, [availableModules]);

  useEffect(() => {
    if (module && !availableModules.some(item => item.id === module.id)) {
      setModule(null);
      setNotificationDestination(null);
    }
  }, [availableModules, module]);

  useEffect(() => state.status === 'signedIn'
    ? watchNotificationOpens(client, state.workspaceId, openNotificationDestination)
    : undefined, [client, openNotificationDestination, state]);

  useEffect(() => {
    entrance.setValue(reducedMotion ? 1 : 0);
    const animation = Animated.timing(entrance, { toValue: 1, duration: reducedMotion ? 0 : 220,
      easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [activeTab, module, entrance, reducedMotion]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (module) { setModule(null); return true; }
      if (activeTab === 'home') return false;
      setActiveTab('home');
      return true;
    });
    return () => subscription.remove();
  }, [activeTab, module]);

  return <SafeAreaView testID="home-screen" edges={['right', 'bottom', 'left']} style={[styles.screen, { backgroundColor: colors.canvas }]}>
    <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
    <Animated.View nativeID="home-tab-panel" role="tabpanel" accessibilityLabel={title}
      style={[styles.content, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>
      {onHome ? <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        <View style={[styles.hero, { paddingTop: insets.top + 12, backgroundColor: colors.canvas }]}>
          <View style={[styles.topRow, { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' }]}>
            <View style={styles.brand} accessibilityLabel="Wodana">
              <Image source={brandMarkSource} style={styles.brandMark} resizeMode="contain" />
              <Text size="xl" weight="semibold" style={{ color: colors.text }}>wodana</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Open profile" onPress={() => changeTab('profile')}
              style={({ pressed }) => [styles.avatar, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }, pressed && styles.pressed]}>
              <Text weight="semibold" style={{ color: colors.text }}>{initials}</Text>
            </Pressable>
          </View>
          <View style={styles.greeting}>
            <Text size="3xl" weight="semibold">{greeting}, {firstName}</Text>
            <Text size="sm" tone="textSecondary">Here’s what’s happening across your work.</Text>
          </View>
        </View>
        <View style={styles.homeBody}>
          {workspace && <View accessibilityLabel={`Active organization: ${workspace.workspaceName}`}
            style={[styles.organization, { backgroundColor: colors.surface, borderColor: colors.border,
              flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' }]}>
            {logoUrl ? <Image source={{ uri: logoUrl }} style={styles.organizationMark} resizeMode="contain" />
              : <View style={[styles.organizationMark, styles.organizationFallback, { borderColor: workspace.workspacePrimaryColor ?? colors.actionPrimary, backgroundColor: colors.actionPrimarySubtle }]}>
                <Text size="xs" weight="semibold" style={{ color: colors.actionPrimary }}>{workspace.workspaceName.slice(0, 2).toUpperCase()}</Text>
              </View>}
            <View style={{ flex: 1, flexShrink: 1 }}>
              <Text size="2xs" tone="textSecondary">ACTIVE WORKSPACE</Text>
              <Text size="md" weight="semibold" numberOfLines={1}>{workspace.workspaceName}</Text>
            </View>
          </View>}

          {workspace?.billingAccess?.warning && <Surface muted accessibilityLiveRegion="polite"
            style={[styles.billingNotice, { borderColor: colors.border }]}>
            <Text size="2xs" weight="semibold" style={{ color: colors.actionPrimary }}>BILLING NOTICE</Text>
            <Text size="xs" tone="textSecondary">{workspace.billingAccess.message}</Text>
          </Surface>}

          {state.status === 'signedIn' && availableModules.some(item => item.id === 'hrms') && <HomeUpdates key={state.workspaceId} workspaceId={state.workspaceId}
            workspaceName={workspace?.workspaceName || 'Wodana'} onOpen={openUpdate} />}

          <View style={styles.modules}>
            <View style={styles.sectionHeading}>
              <Text accessibilityRole="header" size="xl" weight="semibold">Your workspace</Text>
              <Text size="xs" tone="textSecondary">Only tools available to your role are shown.</Text>
            </View>
            <View style={styles.grid}>
              {availableModules.map((item, index) => {
                const featured = index === 0;
                return <Pressable key={item.id} testID={`module-${item.id}`} accessibilityRole="button"
                  accessibilityLabel={`Open ${item.label}. ${item.description}`} onPress={() => openModule(item)}
                  style={({ pressed }) => [styles.card, featured ? styles.cardFeatured : styles.cardCompact,
                    { backgroundColor: featured ? colors.actionPrimarySubtle : pressed ? colors.surfacePressed : colors.surface,
                      borderColor: featured ? colors.actionPrimary : colors.border }, pressed && styles.pressed]}>
                  <View style={[styles.moduleIcon, { backgroundColor: featured ? colors.navigationSelected : colors.surfaceMuted }]}>
                    <Icon name={item.id} size={featured ? 24 : 21} color={colors.actionPrimary} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text size="2xs" weight="semibold" style={{ color: colors.actionPrimary }}>{item.group.toUpperCase()}</Text>
                    <Text size={featured ? 'xl' : 'md'} weight="semibold">{item.label}</Text>
                    <Text size="xs" tone="textSecondary">{item.description}</Text>
                  </View>
                  {featured && <View style={[styles.openAction, { backgroundColor: colors.actionPrimary }]}>
                    <Icon name={direction === 'rtl' ? 'arrow-left' : 'arrow-right'} size={17} color={colors.actionOnPrimary} />
                  </View>}
                </Pressable>;
              })}
            </View>
          </View>
        </View>
      </ScrollView> : <View style={[styles.destination, { paddingTop: insets.top + 12, backgroundColor: colors.canvas }]}>
        <View style={[styles.destinationHeader, { borderBottomColor: colors.border, backgroundColor: colors.canvas }]}>
          {module && <Pressable accessibilityRole="button" accessibilityLabel="Back to Home" onPress={() => setModule(null)} style={styles.back}>
            <Icon name="arrow-left" size={22} color={colors.icon} />
          </Pressable>}
          {module && <View style={[styles.moduleHeaderIcon, { backgroundColor: colors.actionPrimarySubtle }]}>
            <Icon name={module.id} size={20} color={colors.actionPrimary} />
          </View>}
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" size="xl" weight="semibold">{title}</Text>
            {module && <Text size="2xs" tone="textSecondary" numberOfLines={1}>{module.description}</Text>}
          </View>
        </View>
        {module?.id === 'hrms' && state.status === 'signedIn' && <HrmsScreen key={state.workspaceId} workspaceId={state.workspaceId} initialDestination={hrmsDestination}/>}
        {module?.id === 'pre-project' && state.status === 'signedIn' && <PreProjectScreen key={state.workspaceId} workspaceId={state.workspaceId} initialRecordId={notificationDestination?.module === 'pre-project' ? notificationDestination.recordId : null} />}
        {module?.id === 'crm' && state.status === 'signedIn' && <CrmScreen key={state.workspaceId} workspaceId={state.workspaceId} initialDestination={notificationDestination?.module === 'crm' ? notificationDestination : null} />}
        {module?.id === 'projects' && state.status === 'signedIn' && <ProjectsScreen key={state.workspaceId} workspaceId={state.workspaceId} initialRecordId={notificationDestination?.module === 'projects' ? notificationDestination.recordId : null} initialActionId={notificationDestination?.module === 'projects' ? notificationDestination.actionId : null} />}
        {currentTab.id === 'notifications' && state.status === 'signedIn' && <NotificationsScreen workspaceId={state.workspaceId} onOpen={openNotificationDestination} />}
        {currentTab.id === 'profile' && <View style={styles.profile}>
          <View style={[styles.avatar, styles.profileAvatar, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
            <Text weight="semibold">{initials}</Text></View>
          <Text size="xl" weight="semibold">{profile?.displayName}</Text>
          <Text size="sm" tone="textSecondary" style={styles.profileMeta}>{profile?.primaryEmail}</Text>
          <Text size="sm" tone="textSecondary" style={styles.profileMeta}>{workspace?.workspaceName}</Text>
          {state.status === 'signedIn' && <BillingSummary workspaceId={state.workspaceId}/>}
          <Pressable accessibilityRole="button" onPress={() => { if (state.status === 'signedIn') void revokeCurrentNotificationDevice(client, state.workspaceId).finally(onSignOut); else onSignOut(); }}
            style={({ pressed }) => [styles.signOut, { backgroundColor: pressed ? colors.surfacePressed : colors.surface,
              borderColor: colors.borderControl }, pressed && styles.pressed]}>
            <Text size="sm" weight="medium">Sign out</Text>
          </Pressable>
        </View>}
      </View>}
    </Animated.View>
    {!module && <View style={[styles.dock, { backgroundColor: colors.canvas }]}>
      <BottomNavigation activeTab={currentTab.id} onTabChange={changeTab} />
    </View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 28 },
  hero: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 8 },
  topRow: { alignItems: 'center', justifyContent: 'space-between' },
  brand: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandMark: { width: 30, height: 30 },
  greeting: { paddingTop: 28, paddingBottom: 18, gap: 6 },
  homeBody: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 20 },
  organization: { alignItems: 'center', gap: 12, padding: 12, borderWidth: 1, borderRadius: 14 },
  organizationMark: { width: 38, height: 38, borderRadius: 10 },
  organizationFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  billingNotice: { gap: 4, marginTop: 10, padding: 12, borderWidth: 1, borderRadius: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modules: { paddingTop: 14 },
  sectionHeading: { gap: 4, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { borderRadius: 16, borderWidth: 1, gap: 12 },
  cardFeatured: { width: '100%', minHeight: 142, padding: 18, flexDirection: 'row', alignItems: 'center' },
  cardCompact: { flexGrow: 1, flexBasis: '46%', minHeight: 150, padding: 16, alignItems: 'flex-start' },
  moduleIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  openAction: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dock: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  destination: { flex: 1, paddingHorizontal: 20 },
  destinationHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, marginHorizontal: -20, paddingHorizontal: 16, marginBottom: 12 },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  moduleHeaderIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  profile: { alignItems: 'center', paddingVertical: 32 },
  profileAvatar: { width: 72, height: 72, borderRadius: 36, marginBottom: 20 },
  profileMeta: { marginTop: 4 },
  signOut: { minHeight: 48, minWidth: 160, alignItems: 'center', justifyContent: 'center', borderRadius: 10,
    borderWidth: 1, marginTop: 28 },
  pressed: { opacity: 0.7 },
});
