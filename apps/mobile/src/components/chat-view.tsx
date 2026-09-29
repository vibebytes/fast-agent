import { FlashList } from '@shopify/flash-list';
import { type TranscriptEntry } from '@fast-ide/session-view';
import { useCallback, useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';

import type { Display } from '@/bridge/display';
import { bridgeStore } from '@/bridge/store';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { Composer } from '@/components/chat/Composer';
import { MemoEntryBubble } from '@/components/chat/EntryBubble';
import { sessionComposerGate } from '@/components/chat/gate';
import { ApprovalSlot, QuestionBatchSlot, QuestionSlot } from '@/components/chat/Questions';
import { Avatar } from '@/components/shell/avatar';

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
  const snapshot = useBridgeSnapshot();
  const record = snapshot.records[sessionId];
  const entries = record?.transcript.entries ?? EMPTY_ENTRIES;
  const hasMoreOlder = record?.transcript.hasMoreOlder ?? false;
  const staleIds = useMemo(() => staleErrorEntryIds(entries), [entries]);
  const gate = sessionComposerGate(record, snapshot.connection === 'open');
  const busy = gate?.runState === 'running' || gate?.runState === 'stopping';
  const renderItem = useCallback(
    ({ item, index }: { item: TranscriptEntry; index: number }) => (
      <View style={{ marginTop: gapBefore(entries, index) }}>
        <MemoEntryBubble
          entry={item}
          sessionId={sessionId}
          busy={busy}
          stale={staleIds.has(item.id)}
          display={display}
        />
      </View>
    ),
    [entries, sessionId, busy, staleIds, display]
  );
  const keyExtractor = useCallback((entry: TranscriptEntry) => entry.id, []);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' && !inTab ? STACK_HEADER : 0}
      className="flex-1 bg-background"
    >
      <FlashList
        data={entries}
        keyExtractor={keyExtractor}
        extraData={display}
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
