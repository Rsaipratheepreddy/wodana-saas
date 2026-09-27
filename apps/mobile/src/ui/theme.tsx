import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { I18nManager, useColorScheme } from 'react-native';
import { buildTheme, type Brand, type Theme } from './theme-core';

export { buildTheme, type Brand, type Theme };

const ThemeContext = createContext<Theme>(buildTheme('light'));
export function ThemeProvider({ brand, scheme: forced, script = 'latin', children }: PropsWithChildren<{ brand?: Brand; scheme?: 'light' | 'dark'; script?: 'latin' | 'arabic' }>) {
  const device = useColorScheme() === 'dark' ? 'dark' : 'light';
  const scheme = forced ?? device;
  const primary = brand?.primaryColor ?? null;
  const secondary = brand?.secondaryColor ?? null;
  const theme = useMemo(() => buildTheme(scheme, { primaryColor: primary, secondaryColor: secondary }, script, I18nManager.isRTL), [scheme, primary, secondary, script]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);

/** Styles that follow the theme: `const styles = useStyles(makeStyles)` with `makeStyles` defined once, outside the component. */
export function useStyles<S>(make: (theme: Theme) => S): S {
  const theme = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => make(theme), [theme]);
}
