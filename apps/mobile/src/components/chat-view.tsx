import { FlashList } from '@shopify/flash-list';
import { type TranscriptEntry } from '@fast-ide/session-view';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native';

import { bridgeStore } from '@/bridge/store';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { Composer } from '@/components/chat/Composer';
import { MemoEntryBubble } from '@/components/chat/EntryBubble';
import { sessionComposerGate } from '@/components/chat/gate';
import {
  ApprovalSlot,
  FollowUpsBar,
  QuestionBatchSlot,
  QuestionSlot
} from '@/components/chat/Questions';

const EMPTY_ENTRIES: TranscriptEntry[] = [];

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
export function ChatView({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const snapshot = useBridgeSnapshot();
  const record = snapshot.records[sessionId];
  const entries = record?.transcript.entries ?? EMPTY_ENTRIES;
  const hasMoreOlder = record?.transcript.hasMoreOlder ?? false;
  const lastResyncRef = useRef(0);
  const staleIds = useMemo(() => staleErrorEntryIds(entries), [entries]);
  const gate = sessionComposerGate(record);
  const busy = gate?.runState === 'running' || gate?.runState === 'stopping';
  const renderItem = useCallback(
    ({ item }: { item: TranscriptEntry }) => (
      <MemoEntryBubble entry={item} sessionId={sessionId} busy={busy} stale={staleIds.has(item.id)} />
    ),
    [sessionId, busy, staleIds]
  );
  const keyExtractor = useCallback((entry: TranscriptEntry) => entry.id, []);

  const maybeResync = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    if (distanceFromBottom > 150) return;
    const now = Date.now();
    if (now - lastResyncRef.current < 3000) return;
    lastResyncRef.current = now;
    bridgeStore.resyncSession(sessionId);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      className="flex-1 bg-background"
    >
      <FlashList
        data={entries}
        keyExtractor={keyExtractor}
        maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 100 }}
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}
        onScrollEndDrag={maybeResync}
        onMomentumScrollEnd={maybeResync}
        renderItem={renderItem}
        ListEmptyComponent={
          !record ? (
            <View className="items-center justify-center py-24">
              <View className="h-2.5 w-2.5 animate-ping rounded-full bg-primary" />
              <Text className="mt-4 text-xs text-muted">
                {snapshot.connection === 'open' ? t('mobile.chat.loadingTranscript') : t('mobile.chat.connectingDesktop')}
              </Text>
            </View>
          ) : entries.length === 0 ? (
            <View className="items-center justify-center py-24">
              <Text className="text-xs text-muted">{t('mobile.chat.emptyMessages')}</Text>
            </View>
          ) : null
        }
        ListHeaderComponent={
          hasMoreOlder ? (
            <Pressable onPress={() => bridgeStore.loadOlder(sessionId)} className="items-center py-3">
              <Text className="text-xs font-medium text-primary">{t('mobile.chat.loadOlder')}</Text>
            </Pressable>
          ) : null
        }
      />
      <ApprovalSlot sessionId={sessionId} />
      <QuestionBatchSlot sessionId={sessionId} />
      <QuestionSlot sessionId={sessionId} />
      <FollowUpsBar sessionId={sessionId} />
      <Composer sessionId={sessionId} />
    </KeyboardAvoidingView>
  );
}
