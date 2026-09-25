import { router } from 'expo-router';
import { Button, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { bridgeStore } from '@/bridge/store';
import { useBridgeStart, useBridgeSnapshot } from '@/bridge/useBridge';
import { ConnectionBanner, connectionLabel } from '@/components/connection';
import { ScreenHeader } from '@/components/glass-header';

export default function ChatScreen() {
  const { t } = useTranslation();
  useBridgeStart();
  const snapshot = useBridgeSnapshot();
  const current =
    Object.values(snapshot.sessionsByProject)
      .flat()
      .find((s) => s.id === snapshot.lastSessionId) ??
    snapshot.sessions.find((s) => s.id === snapshot.lastSessionId) ??
    null;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        banner={<ConnectionBanner />}
        className="flex-row items-center justify-between border-b border-border/70 px-4 py-3.5"
      >
        <Text className="text-xs text-muted">{connectionLabel(t, snapshot.connection, snapshot.connUi)}</Text>
      </ScreenHeader>
      {current ? (
        <Pressable
          onPress={() => router.push(`/session/${current.id}`)}
          className="mx-4 mt-4 min-h-11 justify-center rounded-2xl border border-border bg-surface px-4 py-3"
        >
          <Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">
            {current.title || t('shell.common.unnamed')}
          </Text>
          {current.summary ? (
            <Text numberOfLines={1} className="mt-1 text-xs text-muted">
              {current.summary}
            </Text>
          ) : null}
        </Pressable>
      ) : (
        <Surface className="mx-4 items-center gap-3 rounded-2xl p-6">
          <Text className="text-center text-muted">
            {snapshot.connection === 'open' ? t('mobile.index.emptyOpen') : t('mobile.index.emptyClosed')}
          </Text>
          <View className="flex-row flex-wrap justify-center gap-2">
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
            <Button variant="secondary" onPress={() => router.push('/history')}>
              {t('mobile.index.goHistory')}
            </Button>
          </View>
        </Surface>
      )}
    </View>
  );
}
