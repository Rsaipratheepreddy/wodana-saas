import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, I18nManager, useColorScheme } from 'react-native';
import { fontFamilies } from './fonts';
import { tokens } from './tokens.generated';

export type ThemeMode = keyof typeof tokens.colors;
export type ThemePreference = ThemeMode | 'system';
type ThemeContextValue = {
  mode: ThemeMode;
  colors: { [Key in keyof typeof tokens.colors.light]: string };
  fonts: { [Key in keyof typeof fontFamilies.latin]: string | undefined };
  direction: 'ltr' | 'rtl';
  locale: string;
  reducedMotion: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function DesignSystemProvider({ children, theme = 'system', locale = 'en', fontsReady = true }: PropsWithChildren<{
  theme?: ThemePreference;
  locale?: string;
  fontsReady?: boolean;
}>) {
  const systemTheme = useColorScheme();
  // Be still until the accessibility preference has been read.
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReducedMotion(value); });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { active = false; listener.remove(); };
  }, []);
  const mode = theme === 'system' ? (systemTheme === 'dark' ? 'dark' : 'light') : theme;
  const arabic = locale.toLowerCase().startsWith('ar');
  const value = useMemo<ThemeContextValue>(() => ({
    mode,
    colors: tokens.colors[mode],
    fonts: fontsReady ? fontFamilies[arabic ? 'arabic' : 'latin'] : { regular: undefined, medium: undefined, semibold: undefined, bold: undefined },
    direction: arabic || I18nManager.isRTL ? 'rtl' : 'ltr',
    locale,
    reducedMotion,
  }), [mode, arabic, locale, reducedMotion, fontsReady]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('Use native UI components inside DesignSystemProvider.');
  return theme;
}

/** Override workspace colors while retaining fonts, direction and accessibility preferences. */
export function DesignSystemColorScope({ colors, children }: PropsWithChildren<{
  colors: Partial<ThemeContextValue['colors']>;
}>) {
  const parent = useTheme();
  const value = useMemo(() => ({ ...parent, colors: { ...parent.colors, ...colors } }), [parent, colors]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
