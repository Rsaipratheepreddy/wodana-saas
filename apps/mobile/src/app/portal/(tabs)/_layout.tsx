import { Tabs } from 'expo-router';
import { ClientTabBar } from '../../../features/client/shell';

export default function ClientTabsLayout() {
  return <Tabs tabBar={(props) => <ClientTabBar {...props} />} screenOptions={{ headerShown: false }}>
    <Tabs.Screen name="index" />
    <Tabs.Screen name="design" />
    <Tabs.Screen name="payments" />
    <Tabs.Screen name="messages" />
    <Tabs.Screen name="more" />
  </Tabs>;
}
