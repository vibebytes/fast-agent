import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { TabBar } from '@/components/shell/tab-bar';

export default function AppTabs() {
  const { t } = useTranslation();
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: t('mobile.tabs.chat') }} />
      <Tabs.Screen name="history" options={{ title: t('mobile.tabs.history') }} />
      <Tabs.Screen name="settings" options={{ title: t('mobile.tabs.settings') }} />
    </Tabs>
  );
}
