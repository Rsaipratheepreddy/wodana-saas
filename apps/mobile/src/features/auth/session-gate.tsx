import type { ReactNode } from 'react';
import { View } from 'react-native';
import { CloudOff, MonitorSmartphone } from 'lucide-react-native';
import { useAuth } from '../../auth/provider';
import { useT } from '../../core/i18n';
import { Button, IconBadge, Text } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';

/**
 * Two states in between signed out and signed in: the server can't be reached to restore the saved
 * sign-in, or the workspace still needs setting up in the browser.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const { client, state } = useAuth();
  const t = useT();
  if (state.status === 'unavailable') {
    return <Notice icon="offline" title={t('Can’t reach your workspace')} detail={t(state.message)}
      primary={{ label: t('Try again'), onPress: () => { void client.restore(); } }} secondary={{ label: t('Sign out'), onPress: () => { void client.signOut(); } }} />;
  }
  if (state.status === 'signedIn' && state.profile.nextAction !== 'enter_workspace') {
    return <Notice icon="setup" title={t('Finish setting up in the browser')} detail={t('Your workspace needs a few details before the app can open it.')}
      primary={{ label: t('Try again'), onPress: () => { void client.restore(); } }} secondary={{ label: t('Sign out'), onPress: () => { void client.signOut(); } }} />;
  }
  return <>{children}</>;
}

function Notice({ icon, title, detail, primary, secondary }: { icon: 'offline' | 'setup'; title: string; detail?: string; primary: { label: string; onPress: () => void }; secondary: { label: string; onPress: () => void } }) {
  const theme = useTheme();
  return <View style={{ flex: 1, backgroundColor: theme.colors.canvas, alignItems: 'center', justifyContent: 'center', padding: theme.space(8), gap: theme.space(4) }}>
    <IconBadge icon={icon === 'offline' ? CloudOff : MonitorSmartphone} size={64} />
    <Text variant="heading" style={{ textAlign: 'center' }}>{title}</Text>
    {detail ? <Text tone="secondary" style={{ textAlign: 'center', maxWidth: 320 }}>{detail}</Text> : null}
    <View style={{ gap: theme.space(2), alignSelf: 'stretch', maxWidth: 360, width: '100%', marginTop: theme.space(2) }}>
      <Button label={primary.label} variant="primary" size="lg" full onPress={primary.onPress} />
      <Button label={secondary.label} variant="ghost" full onPress={secondary.onPress} />
    </View>
  </View>;
}
