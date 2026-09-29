/** The single line above the composer. Order is priority: the first true fact wins. */
export type StatusLine =
  | {kind: 'offline'}
  | {kind: 'lease'; notice: string}
  | {kind: 'decision'}
  | {kind: 'queued'}
  | {kind: 'running'; stopping: boolean};

export type StatusFacts = {
  offline: boolean;
  leaseNotice: string | null;
  /** Composer locked by something other than a visible card. */
  lockedWithoutCard: boolean;
  queued: boolean;
  runState: string | undefined;
};

export function statusLineOf(f: StatusFacts): StatusLine | null {
  if (f.offline) return {kind: 'offline'};
  if (f.leaseNotice) return {kind: 'lease', notice: f.leaseNotice};
  if (f.lockedWithoutCard) return {kind: 'decision'};
  if (f.queued) return {kind: 'queued'};
  if (f.runState === 'running' || f.runState === 'stopping') return {kind: 'running', stopping: f.runState === 'stopping'};
  return null;
}
