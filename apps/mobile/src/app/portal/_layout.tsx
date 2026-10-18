import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { ClientShell } from '../../features/client/shell';
import { ScreenCrash } from '../../ui/crash';
import { useTheme } from '../../ui/theme';

/** A screen that fails to render shows what happened and a way back, never a blank page. */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ScreenCrash {...props} />;
}

/** The client's side of the app: their firm's portal, signed in with their mobile number and a code. */
export default function PortalLayout() {
  const theme = useTheme();
  return <ClientShell>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.canvas } }}>
      <Stack.Screen name="(tabs)" />
    </Stack>
  </ClientShell>;
}
