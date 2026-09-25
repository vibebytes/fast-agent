import { chromeRunId, composerGate } from '@fast-ide/session-view';
import { Pressable, Text } from 'react-native';
import { overlayGoalGate, STOPPABLE_GOAL_PHASES } from '@/bridge/mobile-transcript';
import { bridgeStore, type SessionRecord } from '@/bridge/store';

export function sessionComposerGate(record: SessionRecord | undefined, connected: boolean) {
  if (!record) return null;
  return overlayGoalGate(composerGate(record.transcript, connected && record.ready), record.goalCard);
}

export function hasActionablePrompt(record: SessionRecord | undefined): boolean {
  const transcript = record?.transcript;
  if (!transcript) return false;
  return (
    transcript.questions.length > 0 ||
    transcript.questionBatches.length > 0 ||
    transcript.approvals.length > 0
  );
}

export function StopControl({
  sessionId,
  record,
  gate,
  label,
  className,
  textClassName
}: {
  sessionId: string;
  record: SessionRecord;
  gate: ReturnType<typeof sessionComposerGate>;
  label: string;
  className: string;
  textClassName: string;
}) {
  const canStopRun = Boolean(gate?.canCancel);
  const canStopGoal = Boolean(
    !canStopRun && record.goalCard && STOPPABLE_GOAL_PHASES.has(record.goalCard.phase)
  );
  if (!canStopRun && !canStopGoal) return null;
  return (
    <Pressable
      onPress={() => {
        if (canStopRun) bridgeStore.cancelRun(sessionId, chromeRunId(record.transcript.chrome));
        else bridgeStore.cancelGoal(sessionId, record.goalCard?.goalId);
      }}
      className={className}
    >
      <Text className={textClassName}>{label}</Text>
    </Pressable>
  );
}
