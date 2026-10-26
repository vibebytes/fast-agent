/** A tool result can declare "I created something openable" with a `<fast-artifact>` block.
 *
 * The block is data, not code: the host renders one card for every producer (a 3D room, a
 * document, a generated site) and the click is a closed enum of host actions. No extension id
 * appears in the renderer, so a new producer ships a block instead of a new card component.
 */

export type ArtifactKind = 'scene' | 'document' | 'site' | 'report' | 'dataset' | 'other';

export type ArtifactOpen =
	/** An MCP App (`ui://` page) the rail already knows how to mount. */
	| {kind: 'app'; server: string; resourceUri: string; title?: string}
	/** A workspace-relative file the editor already knows how to open. */
	| {kind: 'file'; path: string}
	/** An extension Web surface: the producer names its own pane, the host only opens it. */
	| {
			kind: 'surface';
			extId: string;
			surfaceId: string;
			url: string;
			instanceKey?: string;
			roomId?: string;
			title?: string;
	  };

export type ArtifactSpec = {
	kind: ArtifactKind;
	title: string;
	subtitle?: string;
	/** Short facts shown as chips: "12 objects", "3 pages", "1.2 MB". */
	meta?: string[];
	open?: ArtifactOpen;
};

export const ARTIFACT_OPEN_TAG = '<fast-artifact>';
const TAGGED = /<fast-artifact>([\s\S]*?)<\/fast-artifact>/i;
const FENCED = /```fast-artifact[ \t]*\r?\n([\s\S]*?)```/i;

const KINDS: readonly ArtifactKind[] = ['scene', 'document', 'site', 'report', 'dataset', 'other'];
const SERVER = /^[A-Za-z0-9._-]{1,64}$/;
const ID = /^[A-Za-z0-9._-]{1,64}$/;
const TAG = /^ui:\/\/[A-Za-z0-9._~\-/]{1,512}$/;

const TITLE_MAX = 120;
const SUBTITLE_MAX = 160;
const CHIP_MAX = 32;
const CHIPS_MAX = 4;

function text(value: unknown, max: number): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.replace(/\s+/g, ' ').trim();
	return trimmed ? trimmed.slice(0, max) : undefined;
}

function chips(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: string[] = [];
	for (const item of value.slice(0, CHIPS_MAX)) {
		const chip = text(item, CHIP_MAX);
		if (chip) out.push(chip);
	}
	return out.length > 0 ? out : undefined;
}

/** A workspace path: relative, no scheme, no traversal — the editor resolves it, not the card. */
function workspacePath(value: unknown): string | undefined {
	const path = text(value, 512);
	if (!path || path.startsWith('/') || path.includes('://')) return undefined;
	if (path.split('/').some(part => part === '..')) return undefined;
	return path;
}

function open(value: unknown): ArtifactOpen | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const raw = value as Record<string, unknown>;
	if (raw.kind === 'app') {
		const server = text(raw.server, 64);
		const resourceUri = text(raw.resourceUri, 512);
		if (!server || !SERVER.test(server) || !resourceUri || !TAG.test(resourceUri)) return undefined;
		const title = text(raw.title, TITLE_MAX);
		return {kind: 'app', server, resourceUri, ...(title ? {title} : {})};
	}
	if (raw.kind === 'file') {
		const path = workspacePath(raw.path);
		return path ? {kind: 'file', path} : undefined;
	}
	if (raw.kind === 'surface') {
		const extId = text(raw.extId, 64);
		const surfaceId = text(raw.surfaceId, 64);
		const url = text(raw.url, 2048);
		if (!extId || !ID.test(extId) || !surfaceId || !ID.test(surfaceId) || !url) return undefined;
		try {
			const parsed = new URL(url);
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
		} catch {
			return undefined;
		}
		return {
			kind: 'surface',
			extId,
			surfaceId,
			url,
			instanceKey: text(raw.instanceKey, 128),
			roomId: text(raw.roomId, 64),
			title: text(raw.title, TITLE_MAX)
		};
	}
	return undefined;
}

/** `null` for anything malformed: a card that cannot be opened is worse than no card. */
export function parseArtifactSpec(raw: unknown): ArtifactSpec | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const obj = raw as Record<string, unknown>;
	const title = text(obj.title, TITLE_MAX);
	if (!title) return null;
	const kind = KINDS.includes(obj.kind as ArtifactKind) ? (obj.kind as ArtifactKind) : 'other';
	const subtitle = text(obj.subtitle, SUBTITLE_MAX);
	const meta = chips(obj.meta);
	// A declared-but-invalid target is a producer bug: degrade to no card rather than to a
	// dead card, and never let a rejected scheme disappear into a harmless-looking tile.
	if (obj.open != null && !open(obj.open)) return null;
	const target = open(obj.open);
	return {kind, title, ...(subtitle ? {subtitle} : {}), ...(meta ? {meta} : {}), ...(target ? {open: target} : {})};
}

function body(output: string): string | null {
	const match = TAGGED.exec(output) ?? FENCED.exec(output);
	return match?.[1]?.trim() || null;
}

/** First declared artifact in a tool result, or `null`. */
export function readArtifact(output: string | null | undefined): ArtifactSpec | null {
	if (!output) return null;
	const raw = body(output);
	if (!raw) return null;
	try {
		return parseArtifactSpec(JSON.parse(raw) as unknown);
	} catch {
		return null;
	}
}

/** The block is metadata for the host, not evidence for the reader — drop it from the log body. */
export function stripArtifact(output: string | null | undefined): string {
	if (!output) return '';
	return output
		.replace(TAGGED, '')
		.replace(FENCED, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
