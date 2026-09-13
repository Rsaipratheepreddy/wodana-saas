import { useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { tokens } from './tokens.generated';
import { loginTheme } from './login-theme';

/** Matches the web's CSS linear-gradient(120deg, lilac 0%, rose 48%, peach 100%). */
export function BrandGradient() {
  const id = useId().replace(/:/g, '');
  const [{ width, height }, setSize] = useState({ width: 360, height: 48 });
  const dx = Math.sin(120 * Math.PI / 180);
  const dy = -Math.cos(120 * Math.PI / 180);
  const length = width * dx + height * dy;

  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={styles.fill} onLayout={({ nativeEvent: { layout } }) => {
      if (layout.width !== width || layout.height !== height) setSize({ width: layout.width, height: layout.height });
    }}>
    <Svg width="100%" height="100%" aria-hidden focusable={false}>
      <Defs>
        <LinearGradient id={id} gradientUnits="userSpaceOnUse"
          x1={(width - dx * length) / 2} y1={(height - dy * length) / 2}
          x2={(width + dx * length) / 2} y2={(height + dy * length) / 2}>
          <Stop offset="0" stopColor={tokens.brand.lilac} />
          <Stop offset="0.48" stopColor={tokens.brand.rose} />
          <Stop offset="1" stopColor={tokens.brand.peach} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" rx={loginTheme.controlRadius - 1} fill={`url(#${id})`} />
    </Svg>
  </View>;
}

const styles = StyleSheet.create({ fill: { ...StyleSheet.absoluteFillObject, pointerEvents: 'none' } });
