import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { tokens } from '../design-system';

/** The original full-screen welcome gradient, intentionally distinct from login. */
export function WelcomeBackdrop() {
  const id = useId().replace(/:/g, '');
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.glow}>
    <Svg width="100%" height="100%" viewBox="0 0 400 880" preserveAspectRatio="none" aria-hidden focusable={false}>
      <Defs>
        <RadialGradient id={`${id}-peach`} cx="105%" cy="6%" rx="110%" ry="70%">
          <Stop offset="0" stopColor={tokens.brand.peach} stopOpacity="0.95" />
          <Stop offset="0.45" stopColor={tokens.brand.peach} stopOpacity="0.65" />
          <Stop offset="1" stopColor={tokens.brand.peach} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id={`${id}-rose`} cx="0%" cy="64%" rx="100%" ry="52%">
          <Stop offset="0" stopColor={tokens.brand.rose} />
          <Stop offset="0.42" stopColor={tokens.brand.rose} stopOpacity="0.75" />
          <Stop offset="1" stopColor={tokens.brand.rose} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id={`${id}-light`} cx="10%" cy="10%" rx="100%" ry="55%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.48" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id={`${id}-bottom`} cx="95%" cy="100%" rx="120%" ry="45%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.38" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect width="400" height="880" fill={tokens.brand.lilac} />
      <Rect width="400" height="880" fill={`url(#${id}-peach)`} />
      <Rect width="400" height="880" fill={`url(#${id}-rose)`} />
      <Rect width="400" height="880" fill={`url(#${id}-light)`} />
      <Rect width="400" height="880" fill={`url(#${id}-bottom)`} />
    </Svg>
  </View>;
}

const styles = StyleSheet.create({ glow: { ...StyleSheet.absoluteFillObject, pointerEvents: 'none' } });
