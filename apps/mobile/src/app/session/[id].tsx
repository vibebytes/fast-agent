import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bridgeStore } from '@/bridge/store';
import { useDisplay } from '@/bridge/use-display';
import { useHomeIds } from '@/bridge/use-home';
import { useBridgeSnapshot, useBridgeStart } from '@/bridge/useBridge';
import { ChatView } from '@/components/chat-view';
import { ConnectionBanner } from '@/components/connection';
import { Glyph } from '@/components/glyphs';
import { useThemeVars } from '@/theme/theme-context';

export default function SessionScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const snapshot = useBridgeSnapshot();
  const insets = useSafeAreaInsets();
  const vars = useThemeVars();
  const isHome = useHomeIds().has(id ?? '');
  const { display, toggle } = useDisplay(id ?? '', isHome);
  useBridgeStart();
  const title = isHome
    ? t('mobile.home.title')
    : Object.values(snapshot.sessionsByProject)
        .flat()
        .find((s) => s.id === id)?.title?.trim() ||
      snapshot.sessions.find((s) => s.id === id)?.title?.trim() ||
      t('shell.common.unnamed');

  useEffect(() => {
    if (!id) return;
    bridgeStore.attach(id);
    return () => bridgeStore.detach(id);
  }, [id]);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title,
          headerShown: true,
          headerRight: () => (
            <Pressable
              onPress={toggle}
              accessibilityRole="button"
              accessibilityLabel={display === 'brief' ? t('mobile.display.toFull') : t('mobile.display.toBrief')}
              className="h-11 w-11 items-center justify-center active:opacity-60"
            >
              <Glyph name={display === 'brief' ? 'full' : 'brief'} size={20} color={vars['--foreground']} />
            </Pressable>
          )
        }}
      />
      <ConnectionBanner />
      {id ? (
        <ChatView sessionId={id} display={display} bottomSpace={insets.bottom} />
      ) : (
        <Text className="mt-6 text-center text-muted">{t('mobile.session.missing')}</Text>
      )}
    </View>
  );
}
