import type {ComposerGate, GoalCardView, TranscriptEntry} from '@fast-ide/session-view';
import type {BridgeEvent} from '@fastllm/bridge-protocol';

/** Marker on optimistic user rows. Not a wire origin — local until a real user row replaces it. */
export const ECHO_ORIGIN = 'mobile_echo';

export const STOPPABLE_GOAL_PHASES = new Set(['started', 'paused', 'escalated']);

export type UserEcho = {clientMessageId: string; text: string};

export function optimisticUserEntry(clientMessageId: string, text: string): TranscriptEntry {
  return {
    id: `echo-${clientMessageId}`,
    role: 'user',
    text,
    status: 'done',
    clientMessageId,
    origin: ECHO_ORIGIN
  };
}

export function isEchoEntry(entry: TranscriptEntry): boolean {
  return entry.role === 'user' && entry.origin === ECHO_ORIGIN;
}

export function matchesEcho(entry: TranscriptEntry, echo: UserEcho): boolean {
  if (entry.role !== 'user' || isEchoEntry(entry)) return false;
  if (
    echo.clientMessageId &&
    (entry.clientMessageId === echo.clientMessageId ||
      entry.turnId === echo.clientMessageId ||
      entry.id === echo.clientMessageId)
  ) {
    return true;
  }
  if (entry.clientMessageId && entry.clientMessageId !== echo.clientMessageId) return false;
  return Boolean(echo.text) && entry.text === echo.text;
}

/** Keep echoes until a real user row matches; never TTL-drop the user's text. */
export function foldUserEchoes(
  entries: TranscriptEntry[],
  pending: ReadonlyArray<UserEcho>
): {entries: TranscriptEntry[]; pending: UserEcho[]} {
  if (pending.length === 0 && !entries.some(isEchoEntry)) return {entries, pending: []};
  const reals = entries.filter((e) => e.role === 'user' && !isEchoEntry(e));
  const used = new Set<TranscriptEntry>();
  const nextPending: UserEcho[] = [];
  for (const echo of pending) {
    const real = reals.find((e) => !used.has(e) && matchesEcho(e, echo));
    if (real) {
      used.add(real);
      continue;
    }
    nextPending.push(echo);
  }
  const withoutEchoes = entries.filter((e) => !isEchoEntry(e));
  const keptEchoes = nextPending.map(
    (echo) =>
      entries.find((row) => isEchoEntry(row) && row.clientMessageId === echo.clientMessageId) ??
      optimisticUserEntry(echo.clientMessageId, echo.text)
  );
  return {entries: [...withoutEchoes, ...keptEchoes], pending: nextPending};
}

export function goalKeepsBusy(card?: GoalCardView | null): boolean {
  return Boolean(card && STOPPABLE_GOAL_PHASES.has(card.phase));
}

/** Desktop SessionController.gate overlay — Esc off; Composer Stop uses CancelGoal. */
export function overlayGoalGate(base: ComposerGate, card?: GoalCardView | null): ComposerGate {
  if (goalKeepsBusy(card) && base.runState === 'idle' && !base.composerLocked) {
    return {
      ...base,
      runState: 'running',
      canSubmitNow: true,
      canEnqueue: false,
      canCancel: false
    };
  }
  return base;
}

export function goalCardFromUpdated(
  event: Extract<BridgeEvent, {type: 'goal_updated'}>
): GoalCardView {
  const escalateKind =
    event.escalateKind === 'infra' || event.escalateKind === 'decision' ? event.escalateKind : undefined;
  return {
    goalId: event.goalId,
    phase: event.phase,
    status: event.status,
    name: event.name ?? undefined,
    statement: event.statement ?? undefined,
    reason: event.reason ?? undefined,
    ...(escalateKind ? {escalateKind} : {})
  };
}

export type BatchDraft = {selected: string[]; custom: string; skipped: boolean};

export function emptyBatchDraft(): BatchDraft {
  return {selected: [], custom: '', skipped: false};
}

export function batchDraftAnswered(d: BatchDraft): boolean {
  return d.selected.length > 0 || d.custom.trim() !== '';
}

export function batchDraftCompleted(d: BatchDraft): boolean {
  return batchDraftAnswered(d) || d.skipped;
}

export function batchAnswersOf(
  questions: Array<{id: string; multiSelect?: boolean}>,
  drafts: Record<string, BatchDraft>
): Array<{id: string; selected: string[]; custom?: string}> {
  return questions.map((q) => {
    const v = drafts[q.id] ?? emptyBatchDraft();
    if (v.skipped) return {id: q.id, selected: []};
    const custom = v.custom.trim();
    return {
      id: q.id,
      selected: custom === '' || q.multiSelect ? v.selected : [],
      ...(custom ? {custom} : {})
    };
  });
}

/** Display-only: Host still receives the original option label. */
export function parseRecommendedLabel(label: string): {label: string; recommended: boolean} {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
  return suffix.test(label)
    ? {label: label.replace(suffix, ''), recommended: true}
    : {label, recommended: false};
}
