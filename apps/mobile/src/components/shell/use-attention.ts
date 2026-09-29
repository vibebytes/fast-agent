import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';

import {attentionOf, type Attention, type SessionFacts} from '@/bridge/attention';
import type {SessionRecord, StoreSnapshot} from '@/bridge/store';
import {useBridgeSnapshot} from '@/bridge/useBridge';
import {sessionComposerGate} from '@/components/chat/gate';

function pendingOf(record: SessionRecord): SessionFacts['pending'] {
  const {approvals, questions, questionBatches} = record.transcript;
  const count = approvals.length + questions.length + questionBatches.length;
  if (count === 0) return null;
  const approval = approvals[0];
  if (approval) return {kind: 'approval', text: approval.description || approval.tool, count};
  const text = questions[0]?.question ?? questionBatches[0]?.questions[0]?.question ?? '';
  return {kind: 'question', text, count};
}

function titleOf(snapshot: StoreSnapshot, sessionId: string): string {
  for (const group of Object.values(snapshot.sessionsByProject)) {
    const hit = group.find((s) => s.id === sessionId);
    if (hit?.title) return hit.title;
  }
  return '';
}

/** Needs-you / working, derived only from sessions this phone has attached. */
export function useAttention(homeId: string | null): Attention {
  const {t} = useTranslation();
  const snapshot = useBridgeSnapshot();
  return useMemo(() => {
    const connected = snapshot.connection === 'open';
    const facts = Object.values(snapshot.records).map((record): SessionFacts => {
      const gate = sessionComposerGate(record, connected);
      return {
        sessionId: record.sessionId,
        title:
          record.sessionId === homeId
            ? t('mobile.home.title')
            : titleOf(snapshot, record.sessionId) || t('shell.common.unnamed'),
        pending: pendingOf(record),
        running: gate?.runState === 'running' || gate?.runState === 'stopping'
      };
    });
    return attentionOf(facts, homeId);
  }, [snapshot, homeId, t]);
}
