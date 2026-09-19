import { tokens } from './tokens.generated';

// Public auth styles mirror the neutral web login and its one action accent.
export const loginTheme = {
  ink: tokens.colors.light.text,
  accent: tokens.colors.light.actionPrimary,
  accentSoft: tokens.colors.light.actionPrimarySubtle,
  muted: tokens.colors.light.textSecondary,
  line: tokens.colors.light.borderControl,
  secondary: tokens.colors.light.surface,
  canvas: tokens.colors.light.canvas,
  controlHeight: 48,
  controlRadius: 12,
  controlFontSize: 13,
  controlLineHeight: 19,
  labelFontSize: 12,
  formGap: 14.4,
} as const;
