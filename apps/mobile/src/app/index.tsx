import { router } from 'expo-router';
import { Button, Surface, Text } from 'heroui-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { bridgeStore } from '@/bridge/store';
import { useBridgeStart, useBridgeSnapshot } from '@/bridge/useBridge';
import { ChatView } from '@/components/chat-view';
import { connectionLabel } from '@/components/connection';

export default function ChatScreen() {
  const { t } = useTranslation();
  useBridgeStart();
  const snapshot = useBridgeSnapshot();

  const currentId = snapshot.lastSessionId ?? snapshot.sessions[0]?.id ?? null;

  useEffect(() => {
    if (!currentId || snapshot.connection !== 'open') return;
    bridgeStore.attach(currentId);
    return () => bridgeStore.detach(currentId);
  }, [currentId, snapshot.connection]);

  return (
    <View className="flex-1 bg-background pt-2">
      <View className="flex-row items-center justify-between px-4 pb-2">
        <Text className="text-xs text-muted">
          {connectionLabel(t, snapshot.connection)}
        </Text>
        <View className="flex-row gap-3">
          <PressableText
            label={t('mobile.index.new')}
            onPress={() => {
              void bridgeStore.createSession().then((id) => {
                if (id) router.push(`/session/${id}`);
              });
            }}
          />
          <PressableText label={t('mobile.tabs.history')} onPress={() => router.push('/history')} />
        </View>
      </View>
      {currentId ? (
        <ChatView sessionId={currentId} />
      ) : (
        <Surface className="mx-4 items-center gap-3 rounded-2xl p-6">
          <Text className="text-center text-muted">
            {snapshot.connection === 'open' ? t('mobile.index.emptyOpen') : t('mobile.index.emptyClosed')}
          </Text>
          {snapshot.connection === 'open' ? (
            <Button
              variant="primary"
              onPress={() => {
                void bridgeStore.createSession().then((id) => {
                  if (id) router.push(`/session/${id}`);
                });
              }}
            >
              {t('mobile.index.newSession')}
            </Button>
          ) : (
            <Button variant="secondary" onPress={() => router.push('/settings')}>
              {t('mobile.index.goSettings')}
            </Button>
          )}
        </Surface>
      )}
    </View>
  );
}

function PressableText({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text className="text-xs font-medium text-primary">{label}</Text>
    </Pressable>
  );
}
