import { router } from 'expo-router';
import { Button, Surface, Text } from 'heroui-native';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';

import { bridgeStore } from '@/bridge/store';
import { useBridgeStart, useBridgeSnapshot } from '@/bridge/useBridge';
import { ChatView } from '@/components/chat-view';

const CONNECTION_LABEL: Record<string, string> = {
  idle: '未连接',
  connecting: '连接中…',
  hello: '握手中…',
  open: '已连接',
  closed: '已断开，重连中…',
  rejected: '被拒绝（检查 token）'
};

export default function ChatScreen() {
  useBridgeStart();
  const snapshot = useBridgeSnapshot();

  const currentId = snapshot.lastSessionId ?? snapshot.sessions[0]?.id ?? null;

  useEffect(() => {
    if (currentId && snapshot.connection === 'open') bridgeStore.attach(currentId);
  }, [currentId, snapshot.connection]);

  return (
    <View className="flex-1 bg-background pt-2">
      <View className="flex-row items-center justify-between px-4 pb-2">
        <Text className="text-xs text-muted">
          {CONNECTION_LABEL[snapshot.connection] ?? snapshot.connection}
        </Text>
        <View className="flex-row gap-3">
          <PressableText label="新建" onPress={() => {
            void bridgeStore.createSession().then((id) => {
              if (id) router.push(`/session/${id}`);
            });
          }} />
          <PressableText label="历史" onPress={() => router.push('/history')} />
        </View>
      </View>
      {currentId ? (
        <ChatView sessionId={currentId} />
      ) : (
        <Surface className="mx-4 items-center gap-3 rounded-2xl p-6">
          <Text className="text-center text-muted">
            {snapshot.connection === 'open' ? '还没有会话，新建一个吧。' : '连接桌面端后开始对话。'}
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
              新建会话
            </Button>
          ) : (
            <Button variant="secondary" onPress={() => router.push('/settings')}>
              去设置
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
