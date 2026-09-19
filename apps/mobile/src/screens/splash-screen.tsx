import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as NativeSplashScreen from 'expo-splash-screen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text, tokens, useTheme } from '../design-system';
import { BrandLogo } from '../components/brand-logo';
import { Icon } from '../components/icon';

/** Welcome is a persistent entry screen; the native launch splash is handled separately. */
export function SplashScreen({ onSignIn, onJoin }: { onSignIn: () => void; onJoin: () => void }) {
  const { reducedMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [ready, setReady] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const compact = height < 680;

  const reveal = useCallback(() => {
    NativeSplashScreen.hide();
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const animation = Animated.timing(opacity, {
      toValue: 1, duration: reducedMotion ? 0 : tokens.motion.slow,
      easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [opacity, ready, reducedMotion]);

  return <View testID="splash-screen" style={styles.screen}>
    <StatusBar style="dark" />
    <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={[
      styles.scroll, { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 20) + 16 },
    ]}>
      <View style={[styles.hero, compact && styles.heroCompact]}>
        <View style={[styles.logoTile, compact && styles.logoTileCompact]}>
          {logoError
            ? <Text size="3xl" weight="semibold" style={styles.ink}>wodana</Text>
            : <BrandLogo width={186} onLoadEnd={reveal} onError={() => { setLogoError(true); reveal(); }} />}
        </View>
      </View>

      <Animated.View style={[styles.actions, { opacity }]}>
        <Button label="Sign in with email" variant="brand" onPress={onSignIn}
          startIcon={<Icon name="mail" size={19} color={tokens.colors.light.actionOnPrimary} />} />
        <Button label="I don’t have an account" variant="brand-secondary" onPress={onJoin} />
      </Animated.View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.colors.light.canvas },
  scroll: { flexGrow: 1, width: '100%', maxWidth: 468, alignSelf: 'center', paddingHorizontal: 24 },
  hero: { flex: 1, minHeight: 280, justifyContent: 'center', alignItems: 'center', paddingVertical: 24 },
  heroCompact: { minHeight: 220, paddingVertical: 20 },
  logoTile: { width: 226, height: 164, alignItems: 'center', justifyContent: 'center' },
  logoTileCompact: { height: 126 },
  ink: { color: tokens.brand.ink },
  actions: { gap: 10 },
});
