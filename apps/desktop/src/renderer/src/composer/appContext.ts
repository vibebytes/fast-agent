/**
 * Model context an MCP App pushes via `ui/update-model-context` (§5.2). It is a composer
 * attachment: nothing is persisted, the latest payload for a toolCallId replaces the earlier one,
 * and the next send consumes it.
 */

export type AppContextImage = {data: string; mimeType: string; name?: string};
export type AppContextLink = {uri: string; name?: string};

export type AppContextEntry = {
	id: string;
	server: string;
	title: string;
	toolCallId?: string;
	text: string[];
	images: AppContextImage[];
	links: AppContextLink[];
};

export type AppContextDraft = Pick<AppContextEntry, 'text' | 'images' | 'links'>;

const MAX_IMAGES = 5;

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Page payloads are untrusted: read `content` blocks, ignore anything unrecognised. */
export function readAppContext(payload: unknown): AppContextDraft {
	const draft: AppContextDraft = {text: [], images: [], links: []};
	const content = asRecord(payload).content;
	if (!Array.isArray(content)) return draft;
	for (const raw of content) {
		const block = asRecord(raw);
		if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
			draft.text.push(block.text);
			continue;
		}
		if (
			block.type === 'image' &&
			typeof block.data === 'string' &&
			typeof block.mimeType === 'string' &&
			draft.images.length < MAX_IMAGES
		) {
			draft.images.push({
				data: block.data,
				mimeType: block.mimeType,
				...(typeof block.name === 'string' ? {name: block.name} : {})
			});
			continue;
		}
		if (
			(block.type === 'resource_link' || block.type === 'resource') &&
			typeof block.uri === 'string'
		) {
			draft.links.push({uri: block.uri, ...(typeof block.name === 'string' ? {name: block.name} : {})});
		}
	}
	return draft;
}

const entries = new Map<string, AppContextEntry>();
const listeners = new Set<() => void>();
let cache: AppContextEntry[] | null = null;

function emit() {
	cache = null;
	for (const fn of listeners) fn();
}

export function setAppContext(entry: AppContextEntry): void {
	entries.set(entry.id, entry);
	emit();
}

export function removeAppContext(id: string): void {
	if (entries.delete(id)) emit();
}

export function clearAppContexts(): void {
	if (entries.size === 0) return;
	entries.clear();
	emit();
}

export function appContextSnapshot(): AppContextEntry[] {
	if (!cache) cache = [...entries.values()];
	return cache;
}

export function subscribeAppContext(fn: () => void): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}
