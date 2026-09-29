import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { TabBar } from '@/components/shell/tab-bar';
import { useThemeVars } from '@/theme/theme-context';

export default function AppTabs() {
  const { t } = useTranslation();
  const vars = useThemeVars();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: vars['--background'] }
      }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: t('mobile.tabs.chat') }} />
      <Tabs.Screen name="history" options={{ title: t('mobile.tabs.history') }} />
      <Tabs.Screen name="settings" options={{ title: t('mobile.tabs.settings') }} />
    </Tabs>
  );
}
