import { Stack } from 'expo-router';
import { useTheme } from '../../ui/theme';

// A firm's own client build opens on its portal's sign-in.
export const unstable_settings = { initialRouteName: process.env.EXPO_PUBLIC_CLIENT_PORTAL ? 'client' : 'sign-in' };

export default function AuthLayout() {
  const theme = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.canvas } }}>
    <Stack.Screen name="sign-in" />
    <Stack.Screen name="verify" />
    <Stack.Screen name="forgot" />
    <Stack.Screen name="client" />
  </Stack>;
}
