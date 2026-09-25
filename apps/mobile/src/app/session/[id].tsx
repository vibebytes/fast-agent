import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { bridgeStore } from '@/bridge/store';
import { useBridgeSnapshot, useBridgeStart } from '@/bridge/useBridge';
import { ChatView } from '@/components/chat-view';
import { ConnectionBanner } from '@/components/connection';

export default function SessionScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const snapshot = useBridgeSnapshot();
  useBridgeStart();
  const title =
    Object.values(snapshot.sessionsByProject)
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
      <Stack.Screen options={{ title, headerShown: true }} />
      <ConnectionBanner />
      {id ? (
        <ChatView sessionId={id} />
      ) : (
        <Text className="mt-6 text-center text-muted">{t('mobile.session.missing')}</Text>
      )}
    </View>
  );
}
