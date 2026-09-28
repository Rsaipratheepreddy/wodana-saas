import { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter, type ErrorBoundaryProps } from 'expo-router';
import { AlertTriangle } from 'lucide-react-native';
import { useT } from '../core/i18n';
import { Button, IconBadge, Text } from './primitives';
import { ThemeProvider, useTheme } from './theme';

function Crash({ error, retry, home }: ErrorBoundaryProps & { home?: () => void }) {
  const t = useT();
  const theme = useTheme();
  useEffect(() => { console.error('A screen failed to render', error); }, [error]);
  return <View accessibilityRole="alert" style={{ flex: 1, backgroundColor: theme.colors.canvas, alignItems: 'center', justifyContent: 'center', padding: theme.space(8), gap: theme.space(4) }}>
    <IconBadge icon={AlertTriangle} tone="warning" size={64} />
    <Text variant="heading" style={{ textAlign: 'center' }}>{t('Something went wrong')}</Text>
    <Text tone="secondary" style={{ textAlign: 'center', maxWidth: 320 }}>{t('Your saved work is safe on this phone.')}</Text>
    <View style={{ gap: theme.space(2), alignSelf: 'stretch', maxWidth: 360, width: '100%', marginTop: theme.space(2) }}>
      <Button label={t('Try again')} variant="primary" size="lg" full onPress={() => { void retry(); }} />
      {home ? <Button label={t('Go to Today')} variant="ghost" full onPress={home} /> : null}
    </View>
  </View>;
}

/** A signed-in screen that failed: try it again, or go back to Today. */
export function ScreenCrash(props: ErrorBoundaryProps) {
  const router = useRouter();
  return <Crash {...props} home={() => { router.replace('/'); void props.retry(); }} />;
}

/** The whole app failed before its providers were ready: the plain theme, and try again. */
export function RootCrash(props: ErrorBoundaryProps) {
  return <ThemeProvider><Crash {...props} /></ThemeProvider>;
}
