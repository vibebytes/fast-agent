export const SESSION_LIST_LIMIT = 20;

/** `sessionsByHash` is keyed by the 12-hex path hash. A Meta workspace id is not registered there. */
export const isRegisteredWorkspaceHash = (hash: string): boolean => /^[0-9a-f]{12}$/i.test(hash);

export type SessionRow = {
  id: string;
  title: string;
  summary: string | null;
  lastModified: string;
  messageCount: number;
  runMode: string | null;
  engineKind: string | null;
};

/**
 * Full page (under the host limit) replaces the project bucket.
 * A full page keeps ids the host did not return, so a truncated list does not wipe the seed.
 * An empty page clears only when the requested hash is a registered project.
 */
export function applyProjectSessions(
  current: readonly SessionRow[],
  incoming: readonly SessionRow[],
  known: boolean
): SessionRow[] {
  if (incoming.length === 0) return known ? [] : [...current];
  if (incoming.length >= SESSION_LIST_LIMIT) {
    const seen = new Set(incoming.map((s) => s.id));
    return [...incoming, ...current.filter((s) => !seen.has(s.id))];
  }
  return [...incoming];
}
