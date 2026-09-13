import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { tokens } from '../design-system';
import { mixWithWhite } from '../design-system/login-theme';

/** The web login's top glow and white fade, with the same colors, stops and layer order. */
export function BrandBackdrop() {
  const id = useId().replace(/:/g, '');
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.glow}>
    <Svg width="100%" height="100%" viewBox="0 0 400 880" preserveAspectRatio="none" aria-hidden focusable={false}>
      <Defs>
        <RadialGradient id={`${id}-lilac`} cx="0%" cy="0%" rx="64%" ry="48%">
          <Stop offset="0.36" stopColor={mixWithWhite(tokens.brand.lilac, 0.72)} />
          <Stop offset="1" stopColor={mixWithWhite(tokens.brand.lilac, 0.72)} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id={`${id}-rose`} cx="50%" cy="0%" rx="48%" ry="44%">
          <Stop offset="0.24" stopColor={mixWithWhite(tokens.brand.rose, 0.42)} />
          <Stop offset="1" stopColor={mixWithWhite(tokens.brand.rose, 0.42)} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id={`${id}-peach`} cx="100%" cy="0%" rx="64%" ry="48%">
          <Stop offset="0.36" stopColor={mixWithWhite(tokens.brand.peach, 0.55)} />
          <Stop offset="1" stopColor={mixWithWhite(tokens.brand.peach, 0.55)} stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id={`${id}-fade`} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <Stop offset="0.44" stopColor="#ffffff" />
          <Stop offset="1" stopColor="#ffffff" />
        </LinearGradient>
      </Defs>
      <Rect width="400" height="880" fill="#ffffff" />
      <Rect width="400" height="880" fill={`url(#${id}-peach)`} />
      <Rect width="400" height="880" fill={`url(#${id}-rose)`} />
      <Rect width="400" height="880" fill={`url(#${id}-lilac)`} />
      <Rect width="400" height="880" fill={`url(#${id}-fade)`} />
    </Svg>
  </View>;
}

const styles = StyleSheet.create({ glow: { ...StyleSheet.absoluteFillObject, pointerEvents: 'none' } });
