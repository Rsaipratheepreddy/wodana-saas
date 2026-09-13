import { useId } from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { tokens } from '../design-system/tokens.generated';
import { moduleIconArt, type ModuleIconName, type ModuleIconShape } from './module-icon-art';

export { moduleIconNames, type ModuleIconName } from './module-icon-art';

/** Decorative module artwork. Give the containing button its own accessible label. */
export function ModuleIcon({ name, size = 28, variant = 'brand', color = tokens.brand.ink }: {
  name: ModuleIconName; size?: number; variant?: 'brand' | 'outline'; color?: string;
}) {
  const gradient = `module-${useId().replace(/:/g, '')}`;
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}
    style={{ pointerEvents: 'none' }}>
    {variant === 'brand' && <Defs>
      <LinearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={tokens.brand.lilac} />
        <Stop offset="0.48" stopColor={tokens.brand.rose} />
        <Stop offset="1" stopColor={tokens.brand.peach} />
      </LinearGradient>
    </Defs>}
    {(moduleIconArt[name].shapes as readonly ModuleIconShape[]).map((shape, index) => {
      const props = {
        ...shape.attributes,
        fill: shape.fill === 'ink' ? color : variant === 'brand' && shape.fill ? `url(#${gradient})` : 'none',
        fillOpacity: shape.fill === 'soft' ? 0.32 : 1,
      };
      if (shape.tag === 'circle') return <Circle key={index} {...props} />;
      if (shape.tag === 'rect') return <Rect key={index} {...props} />;
      return <Path key={index} {...props} />;
    })}
  </Svg>;
}
