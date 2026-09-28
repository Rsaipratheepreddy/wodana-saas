import { View } from 'react-native';
import { Bell } from 'lucide-react-native';
import { useT } from '../../core/i18n';
import { Button, IconBadge, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { useTheme } from '../../ui/theme';
import { usePushRegistration } from './push-registration';

/** Registers this phone for pushes and, the first time, asks in the app's words before the phone's prompt. */
export function PushPrompt() {
  const t = useT();
  const theme = useTheme();
  const { asking, allow, later } = usePushRegistration();
  return <Sheet open={asking} onClose={later}
    footer={<View style={{ gap: theme.space(2) }}>
      <Button label={t('Turn on notifications')} variant="primary" size="lg" full onPress={allow} />
      <Button label={t('Not now')} variant="ghost" full onPress={later} />
    </View>}>
    <View style={{ alignItems: 'center', gap: theme.space(3), paddingVertical: theme.space(4) }}>
      <IconBadge icon={Bell} tone="action" size={56} />
      <Text variant="heading" accessibilityRole="header" style={{ textAlign: 'center' }}>{t('Get told about your work')}</Text>
      <Text tone="secondary" style={{ textAlign: 'center', maxWidth: 320 }}>{t('Work given to you, approvals and site alerts arrive as pushes.')}</Text>
    </View>
  </Sheet>;
}
