/**
 * Composer draft store — isolated from Transcript subscription surfaces (ADR-0006).
 * Updating draft notifies only Composer subscribers.
 *
 * Per-task text is remembered in-process so switching Open Tabs does not wipe the draft.
 */
const draftByTask = new Map<string, string>();

export function rememberedDraft(taskId: string | null | undefined): string {
	if (!taskId) return '';
	return draftByTask.get(taskId) ?? '';
}

export function rememberDraft(taskId: string | null | undefined, text: string): void {
	if (!taskId) return;
	if (text === '') draftByTask.delete(taskId);
	else draftByTask.set(taskId, text);
}

export function createComposerDraftStore(initial = '') {
	let draft = initial;
	const listeners = new Set<() => void>();

	const emit = () => {
		for (const listener of listeners) listener();
	};

	return {
		getSnapshot(): string {
			return draft;
		},
		setDraft(next: string): void {
			if (next === draft) return;
			draft = next;
			emit();
		},
		clear(): void {
			if (draft === '') return;
			draft = '';
			emit();
		},
		restore(text: string): void {
			if (text === draft) return;
			draft = text;
			emit();
		},
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
	};
}

/** Draft store that also mirrors text into `draftByTask` for the given task. */
export function createTaskComposerDraftStore(taskId: string | null | undefined) {
	const id = taskId;
	const inner = createComposerDraftStore(rememberedDraft(id));
	return {
		getSnapshot: () => inner.getSnapshot(),
		subscribe: inner.subscribe,
		setDraft(next: string): void {
			inner.setDraft(next);
			rememberDraft(id, next);
		},
		clear(): void {
			inner.clear();
			rememberDraft(id, '');
		},
		restore(text: string): void {
			inner.restore(text);
			rememberDraft(id, text);
		}
	};
}

export type ComposerDraftStore = ReturnType<typeof createComposerDraftStore>;
