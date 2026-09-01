import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { bridgeStore } from '@/bridge/store';
import { useBridgeStart } from '@/bridge/useBridge';
import { ChatView } from '@/components/chat-view';

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useBridgeStart();

  useEffect(() => {
    if (id) bridgeStore.attach(id);
  }, [id]);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: '会话' }} />
      {id ? (
        <ChatView sessionId={id} />
      ) : (
        <Text className="mt-6 text-center text-muted">会话不存在。</Text>
      )}
    </View>
  );
}
