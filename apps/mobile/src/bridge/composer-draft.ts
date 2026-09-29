import {useSyncExternalStore} from 'react';

/** Text waiting in each session's composer, so an empty-state example can fill it without sending. */
let drafts: Record<string, string> = {};
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setDraft(sessionId: string, text: string): void {
  if (drafts[sessionId] === text) return;
  drafts = {...drafts, [sessionId]: text};
  listeners.forEach((l) => l());
}

export function useDraft(sessionId: string): [string, (text: string) => void] {
  const text = useSyncExternalStore(subscribe, () => drafts[sessionId] ?? '');
  return [text, (next: string) => setDraft(sessionId, next)];
}
