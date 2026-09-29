import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { setDraft } from '@/bridge/composer-draft';
import { useDisplay } from '@/bridge/use-display';
import { useHome } from '@/bridge/use-home';
import { usePersona } from '@/bridge/use-persona';
import { useBridgeSnapshot, useBridgeStart } from '@/bridge/useBridge';
import { ChatView } from '@/components/chat-view';
import { ConnectionBanner } from '@/components/connection';
import { ScreenHeader } from '@/components/glass-header';
import { Avatar } from '@/components/shell/avatar';
import { StatusSheet } from '@/components/shell/status-sheet';
import { useTabBarSpace } from '@/components/shell/tab-bar';
import { useAttention } from '@/components/shell/use-attention';

const EXAMPLES = ['mobile.home.example1', 'mobile.home.example2', 'mobile.home.example3'] as const;

export default function ChatScreen() {
  const { t } = useTranslation();
  useBridgeStart();
  const snapshot = useBridgeSnapshot();
  const persona = usePersona();
  const home = useHome();
  const attention = useAttention(home.sessionId);
  const bottomSpace = useTabBarSpace();
  const [statusOpen, setStatusOpen] = useState(false);
  const { display } = useDisplay(home.sessionId ?? '', true);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader banner={<ConnectionBanner />} className="items-center pb-2 pt-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.avatar.a11y', { name: persona.name })}
          onPress={() => setStatusOpen(true)}
          className="items-center active:opacity-70"
        >
          <Avatar size={40} mood={attention.mood} badge={attention.needsCount} />
          <Text className="mt-0.5 text-[13px] font-semibold text-foreground">{persona.name}</Text>
        </Pressable>
      </ScreenHeader>

      {home.sessionId ? (
        <ChatView
          sessionId={home.sessionId}
          display={display}
          bottomSpace={bottomSpace}
          inTab
          empty={<Greeting sessionId={home.sessionId} name={persona.name} />}
        />
      ) : (
        <View className="flex-1 items-center justify-center gap-4 px-8" style={{ paddingBottom: bottomSpace }}>
          <Avatar size={56} />
          {home.status === 'failed' ? (
            <>
              <Text className="text-center text-[15px] text-muted">{t('mobile.home.failed')}</Text>
              <TextButton label={t('shell.common.retry')} onPress={home.retry} />
            </>
          ) : snapshot.connection === 'open' ? (
            <Text className="text-center text-[13px] text-muted">{t('mobile.home.creating')}</Text>
          ) : snapshot.connection === 'idle' || snapshot.connection === 'rejected' ? (
            <>
              <Text className="text-center text-[15px] text-muted">{t('mobile.index.emptyClosed')}</Text>
              <TextButton label={t('mobile.index.goSettings')} onPress={() => router.push('/settings')} />
            </>
          ) : (
            <Text className="text-center text-[13px] text-muted">{t('mobile.chat.connectingDesktop')}</Text>
          )}
        </View>
      )}

      <StatusSheet
        visible={statusOpen}
        onClose={() => setStatusOpen(false)}
        attention={attention}
        homeId={home.sessionId}
      />
    </View>
  );
}

function Greeting({ sessionId, name }: { sessionId: string; name: string }) {
  const { t } = useTranslation();
  return (
    <View className="items-center px-4 pt-24">
      <Avatar size={56} />
      <Text className="mt-4 text-[17px] font-semibold text-foreground">{t('mobile.home.greeting', { name })}</Text>
      <View className="mt-5 w-full gap-2">
        {EXAMPLES.map((key) => (
          <Pressable
            key={key}
            onPress={() => setDraft(sessionId, t(key))}
            className="min-h-11 justify-center rounded-2xl bg-surface-secondary px-4 py-2.5 active:opacity-70"
          >
            <Text className="text-[15px] text-surface-secondary-foreground">{t(key)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="min-h-11 justify-center px-4 active:opacity-60">
      <Text className="text-[15px] font-semibold text-link">{label}</Text>
    </Pressable>
  );
}
