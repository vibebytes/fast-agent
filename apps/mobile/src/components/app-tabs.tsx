import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { Glyph, type GlyphName } from '@/components/glyphs';
import { useThemeMode, useThemeVars } from '@/theme/theme-context';

export default function AppTabs() {
  const { t } = useTranslation();
  const { scheme } = useThemeMode();
  const vars = useThemeVars();
  const ios = Platform.OS === 'ios';
  const tabIcon = (name: GlyphName) =>
    ({ color, size, focused }: { color: string | object; size: number; focused: boolean }) => (
      <Glyph
        name={name}
        size={size}
        color={typeof color === 'string' ? color : vars['--foreground']}
        filled={focused}
      />
    );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: vars['--foreground'],
        tabBarInactiveTintColor: vars['--muted'],
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        tabBarStyle: {
          backgroundColor: ios ? 'transparent' : vars['--surface'],
          borderTopColor: vars['--border'],
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0
        },
        tabBarBackground: () =>
          ios ? (
            <BlurView
              intensity={64}
              tint={scheme === 'dark' ? 'systemThickMaterialDark' : 'systemThickMaterialLight'}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: vars['--surface'] }]} />
          )
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('mobile.tabs.chat'), tabBarIcon: tabIcon('chat') }} />
      <Tabs.Screen name="history" options={{ title: t('mobile.tabs.history'), tabBarIcon: tabIcon('history') }} />
      <Tabs.Screen name="settings" options={{ title: t('mobile.tabs.settings'), tabBarIcon: tabIcon('settings') }} />
      <Tabs.Screen name="session/[id]" options={{ href: null, headerShown: true, title: t('mobile.tabs.session') }} />
    </Tabs>
  );
}
