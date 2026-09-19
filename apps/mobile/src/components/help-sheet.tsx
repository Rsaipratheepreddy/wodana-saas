import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text, tokens, useTheme } from '../design-system';
import { Icon } from './icon';

export type HelpTopic = 'invitation' | 'recovery';

export function HelpSheet({ topic, onClose, onSignIn }: {
  topic: HelpTopic | null;
  onClose: () => void;
  onSignIn: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useTheme();
  const invitation = topic === 'invitation';
  return <Modal visible={topic !== null} transparent animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable accessible={false} importantForAccessibility="no" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <ScrollView bounces={false} contentContainerStyle={styles.content}>
          <View style={styles.top}>
            <View style={styles.symbol}><Icon name={invitation ? 'mail' : 'lock'} size={26} /></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close help" onPress={onClose} style={styles.close}>
              <Icon name="close" />
            </Pressable>
          </View>
          <Text accessibilityRole="header" size="2xl" weight="semibold" style={styles.ink}>
            {invitation ? 'Join your workspace' : 'Reset your password'}
          </Text>
          <Text style={styles.description}>
            {invitation
              ? 'Ask your workspace administrator for an invitation. Set your password, then return here to sign in.'
              : 'Contact your workspace administrator for help resetting your password.'}
          </Text>
          <Button label={invitation ? 'I have an account' : 'Back to sign in'} variant="brand" onPress={onSignIn} />
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: tokens.colors.light.overlay },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '85%', alignSelf: 'center', borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: tokens.colors.light.surface, overflow: 'hidden' },
  content: { padding: 24, gap: 20 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  symbol: { width: 48, height: 48, borderRadius: 12, backgroundColor: tokens.colors.light.actionPrimarySubtle, alignItems: 'center', justifyContent: 'center' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: tokens.colors.light.surfaceMuted },
  ink: { color: tokens.colors.light.text },
  description: { color: tokens.colors.light.textSecondary, lineHeight: 23 },
});
