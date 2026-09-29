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
import { Glyph } from '@/components/glyphs';
import { Avatar } from '@/components/shell/avatar';
import { DisconnectedState } from '@/components/shell/disconnected-state';
import { StatusSheet } from '@/components/shell/status-sheet';
import { useTabBarSpace } from '@/components/shell/tab-bar';
import { useAttention } from '@/components/shell/use-attention';
import { useThemeVars } from '@/theme/theme-context';

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
  const { display, toggle } = useDisplay(home.sessionId ?? '', true);
  const vars = useThemeVars();

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        banner={<ConnectionBanner />}
        className="min-h-11 flex-row items-center justify-between px-4"
      >
        {home.sessionId ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.avatar.a11y', { name: persona.name })}
              onPress={() => setStatusOpen(true)}
              className="flex-row items-center gap-2 rounded-full py-1 pr-2.5 active:bg-surface-secondary/50"
            >
              <Avatar size={26} mood={attention.mood} badge={attention.needsCount} />
              <Text className="text-[16px] font-semibold text-foreground">{persona.name}</Text>
              <Glyph name="chevron-down" size={12} color={vars['--muted']} />
            </Pressable>
            <Pressable
              onPress={toggle}
              accessibilityRole="button"
              accessibilityLabel={display === 'brief' ? t('mobile.display.toFull') : t('mobile.display.toBrief')}
              className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-secondary/50"
            >
              <Glyph name={display === 'brief' ? 'full' : 'brief'} size={18} color={vars['--foreground']} />
            </Pressable>
          </>
        ) : (
          <View className="flex-1 items-center justify-center">
            <Text className="text-[17px] font-semibold text-foreground">{t('mobile.tabs.chat')}</Text>
          </View>
        )}
      </ScreenHeader>

      {home.sessionId ? (
        <ChatView
          sessionId={home.sessionId}
          display={display}
          bottomSpace={bottomSpace}
          inTab
          empty={<Greeting sessionId={home.sessionId} name={persona.name} />}
        />
      ) : snapshot.connection === 'idle' || snapshot.connection === 'rejected' || snapshot.connUi === 'unconfigured' ? (
        <DisconnectedState bottomSpace={bottomSpace} />
      ) : (
        <View className="flex-1 items-center justify-center gap-3.5 px-8" style={{ paddingBottom: bottomSpace }}>
          <Avatar size={56} />
          {home.status === 'failed' ? (
            <>
              <Text className="text-center text-[15px] text-muted">{t('mobile.home.failed')}</Text>
              <TextButton label={t('shell.common.retry')} onPress={home.retry} />
            </>
          ) : snapshot.connection === 'open' ? (
            <Text className="text-center text-[13px] text-muted">{t('mobile.home.creating')}</Text>
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
  const vars = useThemeVars();
  return (
    <View className="items-center px-4 pt-20">
      <Avatar size={68} />
      <Text className="mt-4 text-[19px] font-bold tracking-tight text-foreground">
        {t('mobile.home.greeting', { name })}
      </Text>
      <View className="mt-7 w-full max-w-sm gap-2.5">
        {EXAMPLES.map((key) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            onPress={() => setDraft(sessionId, t(key))}
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.03,
              shadowRadius: 2,
              elevation: 1
            }}
            className="min-h-[50px] flex-row items-center gap-3 rounded-2xl border border-border/70 bg-surface px-4 py-3 active:opacity-70"
          >
            <View className="h-6 w-6 items-center justify-center rounded-md bg-focus/10">
              <Glyph name="sparkles" size={13} color={vars['--focus']} />
            </View>
            <Text numberOfLines={2} className="flex-1 text-[14px] leading-snug text-foreground">
              {t(key)}
            </Text>
            <Glyph name="chevron-right" size={13} color={vars['--muted']} />
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
