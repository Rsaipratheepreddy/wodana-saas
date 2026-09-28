import { useEffect, useRef } from 'react';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { OutboxProvider } from '../../core/outbox';
import { useSession } from '../../core/session';
import { CaptureProvider } from '../../features/shell/capture-sheet';
import { useNotificationOpens } from '../../features/shell/notifications';
import { PushPrompt } from '../../features/shell/push-prompt';
import { ScreenCrash } from '../../ui/crash';
import { useTheme } from '../../ui/theme';

/** A screen that fails to render shows what happened and a way back, never a blank page. */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ScreenCrash {...props} />;
}

export default function AppLayout() {
  const theme = useTheme();
  const { workspaceId, userId } = useSession();
  const queryClient = useQueryClient();
  const previous = useRef(`${userId}:${workspaceId}`);
  useNotificationOpens();
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
      <PushPrompt />
    </CaptureProvider>
  </OutboxProvider>;
}
