/** What one attached session is asking of the user right now. */
export type SessionFacts = {
  sessionId: string;
  title: string;
  /** Short text of the first blocking card, if any. */
  pending: {kind: 'approval' | 'question'; text: string; count: number} | null;
  running: boolean;
};

export type Mood = 'idle' | 'working' | 'needs';

export type Attention = {
  mood: Mood;
  /** Blocking cards across attached sessions. */
  needsCount: number;
  needs: SessionFacts[];
  working: SessionFacts[];
};

/** "Needs you" wins over "working"; "working" only reflects the home conversation. */
export function attentionOf(facts: readonly SessionFacts[], homeId: string | null): Attention {
  const needs = facts.filter((f) => f.pending);
  const working = facts.filter((f) => f.running);
  const needsCount = needs.reduce((n, f) => n + (f.pending?.count ?? 0), 0);
  const homeRunning = homeId != null && working.some((f) => f.sessionId === homeId);
  const mood: Mood = needsCount > 0 ? 'needs' : homeRunning ? 'working' : 'idle';
  return {mood, needsCount, needs, working};
}
