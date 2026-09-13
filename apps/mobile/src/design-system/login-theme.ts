import { tokens } from './tokens.generated';

// Public auth styles from apps/web/app/login/login.module.css and its live controls.
// Keep these separate from the green action palette used inside the workspace.
export function mixWithWhite(hex: string, amount: number) {
  const channels = hex.slice(1).match(/../g)!.map((channel) => Math.round(parseInt(channel, 16) * amount + 255 * (1 - amount)));
  return `rgb(${channels.join(', ')})`;
}

export const loginTheme = {
  ink: tokens.brand.ink,
  accent: '#694f7a',
  accentSoft: '#f0e8fa',
  muted: mixWithWhite(tokens.brand.ink, 0.72),
  line: mixWithWhite(tokens.brand.ink, 0.16),
  secondary: mixWithWhite('#f0e8fa', 0.25),
  canvas: '#ffffff',
  controlHeight: 48,
  controlRadius: 12,
  controlFontSize: 13,
  controlLineHeight: 19,
  labelFontSize: 12,
  formGap: 14.4,
} as const;
