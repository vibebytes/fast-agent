import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useDraft } from '@/bridge/composer-draft';
import { statusLineOf } from '@/bridge/status-line';
import { bridgeStore } from '@/bridge/store';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { useKeyboardShown } from '@/components/use-keyboard';
import { ComposerPill } from './ComposerPill';
import { hasActionablePrompt, sessionComposerGate, StopControl } from './gate';
import { RunSheet } from './RunSheet';
import { StatusLine } from './StatusLine';

/** `bottomSpace` is what sits under the composer when the keyboard is down: tab bar or home indicator. */
export function Composer({ sessionId, bottomSpace }: { sessionId: string; bottomSpace: number }) {
  const { t } = useTranslation();
  const snapshot = useBridgeSnapshot();
  const keyboard = useKeyboardShown();
  const record = snapshot.records[sessionId];
  const gate = sessionComposerGate(record, snapshot.connection === 'open');
  const [text, setText] = useDraft(sessionId);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [runSheet, setRunSheet] = useState(false);

  const offline = snapshot.connection !== 'open';
  const locked = (gate?.composerLocked ?? false) || offline;
  const line = statusLineOf({
    offline,
    leaseNotice: snapshot.leaseNotice,
    lockedWithoutCard: locked && !offline && !hasActionablePrompt(record),
    queued: snapshot.queuedSessionId === sessionId,
    runState: gate?.runState
  });

  const submit = () => {
    const value = text.trim();
    if (!value || locked) return;
    const hasUserTurn = (record?.transcript.entries ?? []).some((entry) => entry.role === 'user');
    const result = bridgeStore.sendUserMessage(sessionId, value, {
      clientMessageId: pendingId ?? undefined,
      generateTitle: !hasUserTurn
    });
    if (result.sent) {
      setPendingId(null);
      setText('');
    } else {
      setPendingId(result.clientMessageId);
    }
  };

  return (
    <View className="bg-background pt-1" style={{ paddingBottom: (keyboard ? 0 : bottomSpace) + 8 }}>
      <RunSheet sessionId={sessionId} visible={runSheet} onClose={() => setRunSheet(false)} />
      <StatusLine
        line={line}
        onOpenRun={() => setRunSheet(true)}
        stop={
          record ? (
            <StopControl
              sessionId={sessionId}
              record={record}
              gate={gate}
              label={t('shell.common.stop')}
              className="ml-2 min-h-8 justify-center rounded-full bg-danger/10 px-3.5 active:opacity-60"
              textClassName="text-[13px] font-semibold text-danger"
            />
          ) : null
        }
      />
      <View className="px-4 pt-1">
        <ComposerPill
          value={text}
          onChange={setText}
          onSend={submit}
          placeholder={locked ? t('mobile.chat.placeholderLocked') : t('mobile.chat.placeholder')}
          locked={locked}
          voice
        />
      </View>
    </View>
  );
}
