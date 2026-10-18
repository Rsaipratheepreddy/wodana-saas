import { Tabs } from 'expo-router';
import { TabBar } from '../../../features/shell/tab-bar';

export default function TabsLayout() {
  return <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
    <Tabs.Screen name="index" />
    <Tabs.Screen name="work" />
    <Tabs.Screen name="capture" />
    <Tabs.Screen name="inbox" />
    <Tabs.Screen name="me" />
  </Tabs>;
}
