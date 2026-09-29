import { useEffect, useRef } from 'react';
import { Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { OutboxProvider } from '../../core/outbox';
import { useSession } from '../../core/session';
import { CaptureProvider } from '../../features/shell/capture-sheet';
import { useNotificationOpens } from '../../features/shell/notifications';
import { usePushRegistration } from '../../features/shell/push-registration';
import { useTheme } from '../../ui/theme';

export default function AppLayout() {
  const theme = useTheme();
  const { workspaceId, userId } = useSession();
  const queryClient = useQueryClient();
  const previous = useRef(`${userId}:${workspaceId}`);
  useNotificationOpens();
  usePushRegistration();
  useEffect(() => {
    // Another person or workspace never sees the last one's cached lists.
    const current = `${userId}:${workspaceId}`;
    if (previous.current !== current) queryClient.clear();
    previous.current = current;
    return () => { queryClient.clear(); };
  }, [userId, workspaceId, queryClient]);
  return <OutboxProvider>
    <CaptureProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.canvas } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="capture/markup" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      </Stack>
    </CaptureProvider>
  </OutboxProvider>;
}
