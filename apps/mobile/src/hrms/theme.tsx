import type { PropsWithChildren } from 'react';
import { DesignSystemColorScope, useTheme } from '../design-system/provider';
import { tokens } from '../design-system';

// Keep workspace pages quiet and neutral. Brand colour is reserved for actions,
// selected states and the Wodana gradient instead of tinting the whole screen.
const light = {
  canvas: '#f8faf9', surface: '#ffffff', surfaceSubtle: '#fcfdfc',
  surfaceMuted: '#f1f4f2', surfaceHover: '#edf2ef', surfacePressed: '#e5ebe8', surfaceSelected: '#f0e8fa',
  text: tokens.brand.ink, textSecondary: '#625b62', textTertiary: '#746d74',
  icon: '#694f7a', iconSubtle: '#786b7a',
  border: '#e3e8e5', borderControl: '#d2c7d8', borderStrong: '#a88bb8',
  actionPrimary: '#694f7a', actionPrimaryHover: '#594167', actionPrimaryPressed: '#493354',
  actionPrimarySubtle: '#f0e8fa', actionOnPrimary: '#ffffff',
  focus: '#694f7a', link: '#694f7a', linkHover: '#493354', info: '#694f7a', infoSubtle: '#f0e8fa',
};
const dark = {
  canvas: '#1c1720', surface: '#28222d', surfaceSubtle: '#302635',
  surfaceMuted: '#362b3e', surfaceHover: '#3d3046', surfacePressed: '#493653', surfaceSelected: '#3d3046',
  text: '#f6edf8', textSecondary: '#ccbbd1', textTertiary: '#b5a3bc',
  icon: '#d6b9f3', iconSubtle: '#b5a3bc',
  border: '#3c3043', borderControl: '#64506f', borderStrong: '#a586b7',
  actionPrimary: '#d6b9f3', actionPrimaryHover: '#e2cbf7', actionPrimaryPressed: '#ead9fa',
  actionPrimarySubtle: '#3d3046', actionOnPrimary: '#2f232d',
  focus: '#d6b9f3', link: '#d6b9f3', linkHover: '#e2cbf7', info: '#d6b9f3', infoSubtle: '#3d3046',
};

export function HrmsTheme({ children }: PropsWithChildren) {
  const { mode } = useTheme();
  return <DesignSystemColorScope colors={mode === 'high-contrast' ? {} : mode === 'dark' ? dark : light}>
    {children}
  </DesignSystemColorScope>;
}
