import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { bridgeStore } from '@/bridge/store';
import { useBridgeStart } from '@/bridge/useBridge';
import { ChatView } from '@/components/chat-view';

export default function SessionScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  useBridgeStart();

  useEffect(() => {
    if (!id) return;
    bridgeStore.attach(id);
    return () => bridgeStore.detach(id);
  }, [id]);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: t('mobile.tabs.session') }} />
      {id ? (
        <ChatView sessionId={id} />
      ) : (
        <Text className="mt-6 text-center text-muted">{t('mobile.session.missing')}</Text>
      )}
    </View>
  );
}
