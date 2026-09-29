import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { type TranscriptEntry } from '@fast-ide/session-view';
import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  Text,
  View
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, FadeOutUp } from 'react-native-reanimated';

import type { Display } from '@/bridge/display';
import { bridgeStore } from '@/bridge/store';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { Composer } from '@/components/chat/Composer';
import { MemoEntryBubble } from '@/components/chat/EntryBubble';
import { sessionComposerGate } from '@/components/chat/gate';
import { ApprovalSlot, QuestionBatchSlot, QuestionSlot } from '@/components/chat/Questions';
import { Glyph } from '@/components/glyphs';
import { Avatar } from '@/components/shell/avatar';
import { lightImpact } from '@/lib/haptics';
import { useThemeVars } from '@/theme/theme-context';

const EMPTY_ENTRIES: TranscriptEntry[] = [];
/** Native stack header height the keyboard offset has to clear on a pushed session page. */
const STACK_HEADER = 88;

function staleErrorEntryIds(entries: readonly TranscriptEntry[]): Set<string> {
  const stale = new Set<string>();
  let pending: string | null = null;
  for (const entry of entries) {
    if (entry.role !== 'assistant') continue;
    if (entry.status === 'error') {
      if (pending !== null) stale.add(pending);
      pending = entry.id;
    } else if (entry.status === 'done' || entry.status === 'cancelled') {
      if (pending !== null) {
        stale.add(pending);
        pending = null;
      }
    }
  }
  return stale;
}

/** Same speaker 6, speaker change 16, a new user turn 24. */
function gapBefore(entries: readonly TranscriptEntry[], index: number): number {
  const prev = entries[index - 1];
  const cur = entries[index];
  if (!prev || !cur) return 0;
  if (prev.role === cur.role) return 6;
  return cur.role === 'user' ? 24 : 16;
}

export function ChatView({
  sessionId,
  display,
  bottomSpace,
  inTab = false,
  empty
}: {
  sessionId: string;
  display: Display;
  bottomSpace: number;
  inTab?: boolean;
  /** Shown when the conversation has no messages yet. */
  empty?: ReactElement;
}) {
  const { t } = useTranslation();
  const vars = useThemeVars();
  const snapshot = useBridgeSnapshot();
  const record = snapshot.records[sessionId];
  const entries = record?.transcript.entries ?? EMPTY_ENTRIES;
  const hasMoreOlder = record?.transcript.hasMoreOlder ?? false;
  const staleIds = useMemo(() => staleErrorEntryIds(entries), [entries]);
  const gate = sessionComposerGate(record, snapshot.connection === 'open');
  const busy = gate?.runState === 'running' || gate?.runState === 'stopping';

  const listRef = useRef<FlashListRef<TranscriptEntry> | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => {
      setToast(null);
    }, 1800);
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    setShowScrollBottom(distanceFromBottom > 260);
  }, []);

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
    lightImpact();
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: TranscriptEntry; index: number }) => (
      <View style={{ marginTop: gapBefore(entries, index) }}>
        <MemoEntryBubble
          entry={item}
          sessionId={sessionId}
          busy={busy}
          stale={staleIds.has(item.id)}
          display={display}
          onCopy={showToast}
        />
      </View>
    ),
    [entries, sessionId, busy, staleIds, display, showToast]
  );
  const keyExtractor = useCallback((entry: TranscriptEntry) => entry.id, []);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' && !inTab ? STACK_HEADER : 0}
      className="flex-1 bg-background"
    >
      {toast ? (
        <Animated.View
          entering={FadeInDown.springify().damping(16)}
          exiting={FadeOutUp.duration(150)}
          style={{ position: 'absolute', top: 12, alignSelf: 'center', zIndex: 100 }}
          pointerEvents="none"
          className="flex-row items-center gap-2 rounded-full border border-black/[0.04] bg-surface px-4 py-2 shadow-lg dark:border-white/10 dark:border-t-white/25"
        >
          <Glyph name="check" size={14} color="#17c964" />
          <Text className="text-[13px] font-semibold text-foreground">{toast}</Text>
        </Animated.View>
      ) : null}

      <FlashList
        ref={listRef}
        data={entries}
        keyExtractor={keyExtractor}
        extraData={display}
        onScroll={onScroll}
        scrollEventThrottle={32}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 100 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16 }}
        renderItem={renderItem}
        ListEmptyComponent={
          !record ? (
            <View className="items-center justify-center gap-4 py-24">
              <Avatar size={48} />
              <Text className="text-[13px] text-muted">
                {snapshot.connection === 'open' ? t('mobile.chat.loadingTranscript') : t('mobile.chat.connectingDesktop')}
              </Text>
            </View>
          ) : entries.length === 0 ? (
            (empty ?? (
              <View className="items-center justify-center py-24">
                <Text className="text-[13px] text-muted">{t('mobile.chat.emptyMessages')}</Text>
              </View>
            ))
          ) : null
        }
        ListHeaderComponent={
          hasMoreOlder ? (
            <Pressable onPress={() => bridgeStore.loadOlder(sessionId)} className="min-h-11 items-center justify-center">
              <Text className="text-[13px] font-medium text-link">{t('mobile.chat.loadOlder')}</Text>
            </Pressable>
          ) : null
        }
      />

      {showScrollBottom ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(140)}
          style={{ position: 'absolute', right: 16, bottom: bottomSpace + 74, zIndex: 50 }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.chat.scrollToBottom')}
            onPress={scrollToBottom}
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 0.18,
              shadowRadius: 8,
              elevation: 4
            }}
            className="h-10 w-10 items-center justify-center rounded-full border border-black/[0.06] bg-surface active:opacity-75 dark:border-white/15 dark:border-t-white/30"
          >
            <Glyph name="arrow-down" size={18} color={vars['--foreground']} />
          </Pressable>
        </Animated.View>
      ) : null}

      {(record?.transcript.approvals.length ?? 0) > 0 ? (
        <ApprovalSlot sessionId={sessionId} />
      ) : (record?.transcript.questionBatches.length ?? 0) > 0 ? (
        <QuestionBatchSlot sessionId={sessionId} />
      ) : (
        <QuestionSlot sessionId={sessionId} />
      )}
      <Composer sessionId={sessionId} bottomSpace={bottomSpace} />
    </KeyboardAvoidingView>
  );
}
