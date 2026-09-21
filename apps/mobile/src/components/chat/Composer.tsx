import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassHeader } from '@/components/glass-header';
import { Glyph } from '@/components/glyphs';
import { VoiceButton } from '@/components/voice-button';
import { useThemeVars } from '@/theme/theme-context';
import { bridgeStore } from '@/bridge/store';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { hasActionablePrompt, sessionComposerGate, StopControl } from './gate';
import { FollowUpsBar } from './Questions';

export function RunSheet({
  sessionId,
  visible,
  onClose
}: {
  sessionId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const vars = useThemeVars();
  const snapshot = useBridgeSnapshot();
  const record = snapshot.records[sessionId];
  const gate = sessionComposerGate(record);
  const liveProcs = record?.transcript.liveProcs ?? [];
  const [interruptText, setInterruptText] = useState('');
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-background px-4" style={{ paddingTop: insets.top + 8 }}>
        <GlassHeader
          fallbackClassName="bg-surface-secondary"
          className="flex-row items-center justify-between rounded-2xl px-4 py-3"
        >
          <Text className="text-lg font-semibold text-foreground">{t('mobile.chat.consoleTitle')}</Text>
          <Pressable onPress={onClose} className="rounded-xl bg-surface px-3 py-1.5 active:opacity-75">
            <Text className="text-xs font-semibold text-foreground">{t('shell.common.close')}</Text>
          </Pressable>
        </GlassHeader>

        <View className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-foreground">{t('mobile.chat.runStatus')}</Text>
            <View className="flex-row items-center gap-1.5">
              <View
                className={`h-2.5 w-2.5 rounded-full ${
                  gate?.runState === 'running'
                    ? 'bg-primary animate-pulse'
                    : gate?.runState === 'stopping'
                      ? 'bg-warning'
                      : 'bg-muted'
                }`}
              />
              <Text className="text-xs font-medium text-muted">
                {gate?.runState === 'running'
                  ? t('mobile.chat.runRunning')
                  : gate?.runState === 'stopping'
                    ? t('mobile.chat.runStopping')
                    : t('mobile.chat.runIdle')}
              </Text>
            </View>
          </View>

          {record ? (
            <StopControl
              sessionId={sessionId}
              record={record}
              gate={gate}
              label={t('mobile.chat.abortNow')}
              className="mt-3.5 items-center justify-center rounded-xl bg-destructive py-2.5 active:opacity-80"
              textClassName="text-sm font-semibold text-destructive-foreground"
            />
          ) : null}
        </View>

        {liveProcs.length > 0 ? (
          <View className="mt-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <Text className="text-sm font-semibold text-foreground">{t('mobile.chat.liveProcs', { count: liveProcs.length })}</Text>
            {liveProcs.map((proc) => (
              <View
                key={proc.procId}
                className="mt-2.5 flex-row items-center justify-between rounded-xl bg-surface-secondary px-3 py-2"
              >
                <Text numberOfLines={1} className="flex-1 font-mono text-xs text-foreground">
                  {proc.command}
                </Text>
                <Pressable
                  onPress={() => bridgeStore.killProc(sessionId, proc.procId)}
                  className="ml-2 rounded-lg bg-destructive/15 px-2.5 py-1 active:opacity-75"
                >
                  <Text className="text-xs font-semibold text-destructive">{t('mobile.chat.kill')}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <View className="mt-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <Text className="text-sm font-semibold text-foreground">{t('mobile.chat.interruptTitle')}</Text>
          <TextInput
            value={interruptText}
            onChangeText={setInterruptText}
            placeholder={t('mobile.chat.interruptPlaceholder')}
            placeholderTextColor={vars['--muted']}
            multiline
            className="mt-2.5 min-h-[72px] rounded-xl border border-border bg-surface-secondary px-3.5 py-2.5 text-sm text-foreground"
          />
          <Pressable
            onPress={() => {
              if (!interruptText.trim()) return;
              bridgeStore.interruptAndSay(sessionId, interruptText.trim());
              setInterruptText('');
              onClose();
            }}
            disabled={!interruptText.trim()}
            className="mt-3 items-center justify-center rounded-xl bg-primary py-2.5 active:opacity-80 disabled:opacity-40"
          >
            <Text className="text-sm font-semibold text-primary-foreground">{t('mobile.chat.interruptSubmit')}</Text>
          </Pressable>
        </View>

        <View className="mt-3 flex-1">
          <Text className="px-1 text-sm font-semibold text-foreground">{t('mobile.chat.followUpTitle')}</Text>
          <View className="mt-2 flex-1">
            <FollowUpsBar sessionId={sessionId} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function Composer({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const vars = useThemeVars();
  const snapshot = useBridgeSnapshot();
  const record = snapshot.records[sessionId];
  const gate = sessionComposerGate(record);
  const [text, setText] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [runSheet, setRunSheet] = useState(false);

  const submit = () => {
    const value = text.trim();
    if (!value || gate?.composerLocked) return;
    const hasUserTurn = (record?.transcript.entries ?? []).some((entry) => entry.role === 'user');
    const result = bridgeStore.sendUserMessage(sessionId, value, {
      clientMessageId: pendingId ?? undefined,
      generateTitle: !hasUserTurn
    });
    if (result.sent) {
      setPendingId(null);
      setText('');
      if (gate?.canEnqueue) {
        setQueued(true);
        setTimeout(() => setQueued(false), 2000);
      }
    } else {
      setPendingId(result.clientMessageId);
    }
  };

  const handleVoiceSend = (voiceText: string) => {
    if (!voiceText.trim() || gate?.composerLocked) return;
    const hasUserTurn = (record?.transcript.entries ?? []).some((entry) => entry.role === 'user');
    const result = bridgeStore.sendUserMessage(sessionId, voiceText.trim(), {
      generateTitle: !hasUserTurn
    });
    if (result.sent && gate?.canEnqueue) {
      setQueued(true);
      setTimeout(() => setQueued(false), 2000);
    }
  };

  const locked = (gate?.composerLocked ?? false) || snapshot.connection !== 'open';
  const offline = snapshot.connection !== 'open';
  const running = gate?.runState === 'running' || gate?.runState === 'stopping';

  return (
    <View className="border-t border-border bg-background">
      <RunSheet sessionId={sessionId} visible={runSheet} onClose={() => setRunSheet(false)} />

      {snapshot.leaseNotice ? (
        <View className="flex-row items-center gap-1.5 bg-warning/10 px-4 py-2">
          <Text className="text-xs text-warning">
            {snapshot.leaseNotice.startsWith('errors.') || snapshot.leaseNotice.startsWith('shell.')
              ? t(snapshot.leaseNotice)
              : snapshot.leaseNotice}
          </Text>
        </View>
      ) : null}

      {offline ? (
        <View className="flex-row items-center gap-1.5 bg-warning/10 px-4 py-2">
          <Text className="text-xs text-warning">{t('mobile.chat.lockedDisconnected')}</Text>
        </View>
      ) : null}

      {locked && !offline && !hasActionablePrompt(record) ? (
        <View className="flex-row items-center gap-1.5 bg-warning/10 px-4 py-2">
          <Text className="text-xs text-warning">{t('mobile.chat.lockedDecision')}</Text>
        </View>
      ) : null}

      {queued ? (
        <View className="flex-row items-center gap-1.5 bg-primary/10 px-4 py-1.5">
          <Text className="text-xs font-medium text-primary">{t('mobile.chat.queued')}</Text>
        </View>
      ) : null}

      {running ? (
        <View className="mx-3 mt-2 flex-row items-center justify-between rounded-2xl border border-primary/30 bg-primary/10 px-3.5 py-2">
          <Pressable
            onPress={() => setRunSheet(true)}
            className="flex-1 flex-row items-center gap-2"
          >
            <View className="h-2 w-2 animate-ping rounded-full bg-primary" />
            <Text className="text-xs font-semibold text-primary">
              {gate?.runState === 'stopping' ? t('mobile.chat.agentStopping') : t('mobile.chat.agentRunning')}
            </Text>
          </Pressable>
          <View className="flex-row items-center gap-2">
            {record ? (
              <StopControl
                sessionId={sessionId}
                record={record}
                gate={gate}
                label={t('shell.common.stop')}
                className="rounded-lg bg-destructive/20 px-2 py-0.5 active:opacity-70"
                textClassName="text-[11px] font-bold text-destructive"
              />
            ) : null}
            <Pressable
              onPress={() => setRunSheet(true)}
              className="flex-row items-center gap-0.5 rounded-lg bg-surface/80 px-2 py-0.5 active:opacity-70"
            >
              <Text className="text-[11px] font-medium text-foreground">{t('mobile.chat.console')}</Text>
              <Glyph name="chevron-right" size={10} color={vars['--foreground']} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Floating Island Style Input Bar */}
      <View
        style={{ paddingBottom: Math.max(12, insets.bottom) }}
        className="flex-row items-end gap-2.5 px-3.5 pt-2.5"
      >
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={locked ? t('mobile.chat.placeholderLocked') : t('mobile.chat.placeholder')}
          placeholderTextColor={vars['--muted']}
          editable={!locked}
          multiline
          className="max-h-28 min-h-[44px] flex-1 rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm leading-5 text-foreground shadow-sm"
        />

        <VoiceButton onSend={handleVoiceSend} disabled={locked} />

        {running && !text.trim() ? (
          <Pressable
            onPress={() => setRunSheet(true)}
            accessibilityRole="button"
            accessibilityLabel={t('mobile.chat.runA11y')}
            className={`h-[44px] min-w-[54px] flex-row items-center justify-center gap-1.5 rounded-2xl border px-3.5 shadow-sm active:scale-95 ${
              gate?.runState === 'stopping'
                ? 'border-warning/40 bg-warning/10'
                : 'border-primary/40 bg-primary/10'
            }`}
          >
            <View
              className={`h-2 w-2 animate-ping rounded-full ${
                gate?.runState === 'stopping' ? 'bg-warning' : 'bg-primary'
              }`}
            />
            <Text
              className={`text-xs font-semibold ${
                gate?.runState === 'stopping' ? 'text-warning' : 'text-primary'
              }`}
            >
              {gate?.runState === 'stopping' ? t('mobile.chat.stopping') : t('mobile.chat.running')}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={submit}
            disabled={locked || !text.trim()}
            accessibilityRole="button"
            accessibilityLabel={t('mobile.chat.sendA11y')}
            className="h-[44px] min-w-[54px] items-center justify-center rounded-2xl bg-default px-3.5 shadow-sm active:scale-95 active:opacity-80 disabled:opacity-30"
          >
            <Text className="text-sm font-semibold text-default-foreground">{t('shell.common.send')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
