import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../design-system';
import { moduleIconArt, type ModuleIconName, type ModuleIconShape } from './module-icon-art';

export { moduleIconNames, type ModuleIconName } from './module-icon-art';

/** Decorative module artwork. Give the containing button its own accessible label. */
export function ModuleIcon({ name, size = 28, variant = 'brand', color }: {
  name: ModuleIconName; size?: number; variant?: 'brand' | 'outline'; color?: string;
}) {
  const { colors } = useTheme();
  const ink = color ?? colors.icon;
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={ink}
    strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}
    style={{ pointerEvents: 'none' }}>
    {(moduleIconArt[name].shapes as readonly ModuleIconShape[]).map((shape, index) => {
      const props = {
        ...shape.attributes,
        fill: shape.fill === 'ink' ? ink : variant === 'brand' && shape.fill ? colors.actionPrimary : 'none',
        fillOpacity: shape.fill === 'soft' ? 0.16 : 1,
      };
      if (shape.tag === 'circle') return <Circle key={index} {...props} />;
      if (shape.tag === 'rect') return <Rect key={index} {...props} />;
      return <Path key={index} {...props} />;
    })}
  </Svg>;
}
