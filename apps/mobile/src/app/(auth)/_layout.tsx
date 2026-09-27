import { Stack } from 'expo-router';
import { useTheme } from '../../ui/theme';

export const unstable_settings = { initialRouteName: 'sign-in' };

export default function AuthLayout() {
  const theme = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.canvas } }}>
    <Stack.Screen name="sign-in" />
    <Stack.Screen name="verify" />
    <Stack.Screen name="forgot" />
  </Stack>;
}
