import { PreProjectScreen } from './pre-project-screen';
import { HrmsScreen } from './hrms-screen';
import { CrmScreen } from './crm-screen';
import { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Image, Keyboard, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, tokens, useTheme } from '../design-system';
import { loginTheme } from '../design-system/login-theme';
import { useAuth } from '../auth/provider';
import { BottomNavigation, homeTabs, type HomeTab } from '../components/bottom-navigation';
import { BrandLogo } from '../components/brand-logo';
import { Icon } from '../components/icon';
import { homeModules, type HomeModule } from '../components/home-modules';
import { HomeUpdates } from '../components/home-updates';
import type { HrmsDestination } from '../home/updates';

export function HomeScreen({ onSignOut }: { onSignOut: () => void }) {
  const insets = useSafeAreaInsets();
  const { height, width, fontScale } = useWindowDimensions();
  const usableHeight = height - insets.top - insets.bottom;
  const bottomGap = usableHeight < 440 ? 16 : usableHeight < 620 ? 24 : 32;
  const { reducedMotion, direction } = useTheme();
  const { state } = useAuth();
  const profile = state.status === 'signedIn' ? state.profile : null;
  const workspace = state.status === 'signedIn' ? state.profile.memberships.find(item => item.workspaceId === state.workspaceId) : null;
  const initials = profile?.displayName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'W';
  const [activeTab, setActiveTab] = useState<HomeTab>('home');
  const [module, setModule] = useState<HomeModule | null>(null);
  const [hrmsDestination, setHrmsDestination] = useState<HrmsDestination>({ tab: 'attendance' });
  const entrance = useRef(new Animated.Value(1)).current;
  const currentTab = homeTabs.find(tab => tab.id === activeTab) ?? homeTabs[0];
  const onHome = currentTab.id === 'home' && !module;
  const title = module?.label ?? currentTab.label;
  const availableWidth = width - insets.left - insets.right;
  const compact = availableWidth < 360;
  const oneColumn = fontScale > 1.5 || availableWidth < 300;
  const changeTab = (tab: HomeTab) => { Keyboard.dismiss(); setModule(null); setActiveTab(tab); };
  const openModule = (item: HomeModule) => { Keyboard.dismiss(); setHrmsDestination({ tab: 'attendance' }); setModule(item); };
  const openUpdate = (destination: HrmsDestination) => {
    Keyboard.dismiss();
    setHrmsDestination(destination);
    setModule(homeModules.find(item => item.id === 'hrms') ?? null);
  };

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

  return <SafeAreaView testID="home-screen" edges={['right', 'bottom', 'left']} style={styles.screen}>
    <StatusBar style="dark" />
    <Animated.View nativeID="home-tab-panel" role="tabpanel" accessibilityLabel={title}
      style={[styles.content, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>
      {onHome ? <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        <View style={[styles.hero, { paddingTop: insets.top + 12 }]}>
          <LinearGradient colors={['#e3cdf4', '#f0dbe5', '#fad6bb']} locations={[0, 0.5, 1]}
            start={{ x: 0, y: 0.05 }} end={{ x: 1, y: 0.9 }} style={StyleSheet.absoluteFill} />
          <View style={[styles.topRow, { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' }]}>
            <BrandLogo width={130} />
            <Pressable accessibilityRole="button" accessibilityLabel="Open profile" onPress={() => changeTab('profile')}
              style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}>
              <Text weight="semibold" style={styles.initials}>{initials}</Text>
            </Pressable>
          </View>
          {state.status === 'signedIn' && <HomeUpdates key={state.workspaceId} workspaceId={state.workspaceId}
            workspaceName={workspace?.workspaceName || 'Wodana'} onOpen={openUpdate} />}
        </View>
        <View style={styles.modules}>
          <Text accessibilityRole="header" weight="medium" style={styles.sectionTitle}>Modules</Text>
          <View style={[styles.grid, { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' }]}>
            {homeModules.map(item => <Pressable key={item.id} testID={`module-${item.id}`} accessibilityRole="button" accessibilityLabel={`Open ${item.label}`}
              onPress={() => openModule(item)} style={({ pressed }) => [styles.card, { width: oneColumn ? '100%' : '48%', minHeight: compact ? 156 : 164 }, pressed && styles.cardPressed]}>
              <View style={styles.artFrame}>
                {item.image && <Image source={item.image} resizeMode="contain" style={styles.moduleArt} accessible={false} fadeDuration={0} />}
              </View>
              <View style={[styles.cardLabel, { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' }]}>
                <Text weight="medium" style={styles.moduleName}>{item.label}</Text>
                <Icon name="arrow-up-right" size={15} color="#9b8d9f" />
              </View>
            </Pressable>)}
          </View>
        </View>
      </ScrollView> : <View style={[styles.destination, { paddingTop: insets.top + 12 }]}>
        <View style={styles.destinationHeader}>
          {module && <Pressable accessibilityRole="button" accessibilityLabel="Back to Home" onPress={() => setModule(null)} style={styles.back}>
            <Icon name="arrow-left" size={22} />
          </Pressable>}
          <Text accessibilityRole="header" weight="medium" style={styles.destinationTitle}>{title}</Text>
        </View>
        {module?.id === 'hrms' && state.status === 'signedIn' && <HrmsScreen key={state.workspaceId} workspaceId={state.workspaceId} initialDestination={hrmsDestination}/>}
        {module?.id === 'pre-project' && state.status === 'signedIn' && <PreProjectScreen key={state.workspaceId} workspaceId={state.workspaceId} />}
        {module?.id === 'crm' && state.status === 'signedIn' && <CrmScreen key={state.workspaceId} workspaceId={state.workspaceId} />}
        {currentTab.id === 'profile' && <View style={styles.profile}>
          <View style={[styles.avatar, styles.profileAvatar]}><Text weight="semibold" style={styles.initials}>{initials}</Text></View>
          <Text weight="semibold" style={styles.profileName}>{profile?.displayName}</Text>
          <Text style={styles.profileEmail}>{profile?.primaryEmail}</Text>
          <Text style={styles.profileWorkspace}>{workspace?.workspaceName}</Text>
          <Pressable accessibilityRole="button" onPress={onSignOut} style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}>
            <Text weight="medium" style={styles.link}>Sign out</Text>
          </Pressable>
        </View>}
      </View>}
    </Animated.View>
    {!module && <View style={[styles.dock, { paddingBottom: bottomGap }]}>
      <BottomNavigation activeTab={currentTab.id} onTabChange={changeTab} />
    </View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f3f9' },
  content: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 16 },
  hero: { paddingHorizontal: 24, paddingBottom: 24, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden' },
  topRow: { alignItems: 'center', justifyContent: 'space-between' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.68)', borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.88)', alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 14, lineHeight: 20, color: tokens.brand.ink },
  modules: { width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 22 },
  sectionTitle: { fontSize: 13, lineHeight: 20, marginBottom: 12, color: '#786b7a' },
  grid: { flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  card: { padding: 16, borderRadius: 24, backgroundColor: '#ffffff', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#eee7f2', boxShadow: '0px 4px 16px rgba(75,48,85,0.025)' },
  artFrame: { width: 100, height: 100, alignItems: 'center', justifyContent: 'center', marginLeft: -5, marginTop: -5 },
  moduleArt: { width: 108, height: 108 },
  cardLabel: { alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  moduleName: { fontSize: 15, lineHeight: 22, color: tokens.brand.ink, flexShrink: 1 },
  cardPressed: { transform: [{ scale: 0.975 }], backgroundColor: '#fcf9ff' },
  dock: { paddingTop: 12, backgroundColor: '#f6f3f9' },
  destination: { flex: 1, paddingHorizontal: 24, backgroundColor: '#f8faf9' },
  destinationHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  destinationTitle: { fontSize: 22, lineHeight: 30, color: tokens.brand.ink },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  profile: { alignItems: 'center', paddingVertical: 36 },
  profileAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#eadbf3', marginBottom: 20 },
  profileName: { fontSize: 20, lineHeight: 28, color: tokens.brand.ink },
  profileEmail: { fontSize: 13, color: '#786b7a', marginTop: 8 },
  profileWorkspace: { fontSize: 13, color: '#786b7a', marginTop: 4 },
  signOut: { minHeight: 48, paddingHorizontal: 32, justifyContent: 'center', borderRadius: 24, backgroundColor: '#eee5f4', marginTop: 28 },
  link: { fontSize: 13, color: loginTheme.accent },
  pressed: { opacity: 0.7 },
});
