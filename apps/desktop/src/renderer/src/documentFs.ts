import type {GetWorkspaceFileResult} from '@fast-ide/session-view';
import {hasConflictMarkers, merge3, type ConflictChoice} from './documentMerge';
import type {MonacoEditorHandle} from './MonacoEditor';
import type {RailTab} from './railTabs';

export function fsErrorMessage(result: {error?: string; code?: string}): string {
	switch (result.code) {
		case 'too-large':
			return 'File exceeds 2 MB and cannot be opened as text.';
		case 'binary':
			return 'Binary file — cannot open as text.';
		case 'missing':
			return 'File not found.';
		case 'is-dir':
			return 'Path is a directory.';
		case 'outside':
			return 'Path is outside the workspace.';
		case 'no-slot':
			return 'Project not ready — wait for Engine workspace registration.';
		case 'busy':
			return 'Workspace busy (agent writing) — try again shortly.';
		case 'conflict':
			return 'File changed on disk (mtime conflict).';
		default:
			return result.error ?? 'File operation failed';
	}
}

export function openFileAlert(result: GetWorkspaceFileResult): void {
	if (result.ok) return;
	window.alert(fsErrorMessage(result));
}

/** Keep buffer; clear CAS so the next Save creates the path again. */
export function missingDocumentPatch(): Partial<RailTab> {
	return {dirty: true, savedMtimeMs: undefined, savedBytes: undefined};
}

export type DocumentReload =
	| {kind: 'noop'}
	| {kind: 'silent'; content: string; mtime: number; bytes?: number}
	/**
	 * Disk bytes match the last clean snapshot (`baseContent`) but mtime/size moved
	 * (touch, echo, metadata). Keep dirty buffer; only advance the CAS cursor.
	 */
	| {kind: 'advance-cursor'; mtime: number; bytes?: number}
	| {kind: 'conflict'; diskContent: string; diskMtime: number; diskBytes?: number}
	/** Disk path gone — keep buffer, mark dirty, clear CAS cursor so next Save creates. */
	| {kind: 'missing'};

/** Re-Get on tab activate / window focus / workspace_file_changed. */
export async function probeDisk(
	tab: RailTab,
	buffer: MonacoEditorHandle | null | undefined
): Promise<DocumentReload> {
	if (!tab.filePath) return {kind: 'noop'};
	const result = await window.fastIde.getWorkspaceFile(tab.filePath);
	if (!result.ok) {
		if (result.code === 'missing') return {kind: 'missing'};
		return {kind: 'noop'};
	}
	const diskMtime = result.mtime;
	// When both sides have a size cursor, require a match — coarse FS may reuse mtime.
	const bytesMatch =
		tab.savedBytes == null || result.bytes == null || tab.savedBytes === result.bytes;
	if (tab.savedMtimeMs != null && diskMtime === tab.savedMtimeMs && bytesMatch) {
		return {kind: 'noop'};
	}
	if (!tab.dirty) {
		return {kind: 'silent', content: result.content, mtime: diskMtime, bytes: result.bytes};
	}
	const ours = buffer?.getValue() ?? tab.baseContent ?? '';
	if (ours === result.content) {
		return {kind: 'silent', content: result.content, mtime: diskMtime, bytes: result.bytes};
	}
	// Metadata-only / echo: disk text still equals last clean open/save snapshot.
	if ((tab.baseContent ?? '') === result.content) {
		return {kind: 'advance-cursor', mtime: diskMtime, bytes: result.bytes};
	}
	return {
		kind: 'conflict',
		diskContent: result.content,
		diskMtime,
		diskBytes: result.bytes
	};
}

export type ConflictApply = {
	/** Updated tab metadata. */
	patch: Partial<RailTab>;
	/** Buffer text to write into Monaco (undefined = leave). */
	buffer?: string;
};

/** Pure conflict resolution — used by UI and unit tests. */
export function applyConflictChoice(
	choice: ConflictChoice,
	input: {
		tab: RailTab;
		ours: string;
		diskContent: string;
		diskMtime: number;
		diskBytes?: number;
	}
): ConflictApply | null {
	if (choice === 'cancel') return null;
	if (choice === 'disk') {
		return {
			patch: {
				baseContent: input.diskContent,
				savedMtimeMs: input.diskMtime,
				savedBytes: input.diskBytes,
				dirty: false,
				editorEpoch: (input.tab.editorEpoch ?? 0) + 1
			},
			buffer: input.diskContent
		};
	}
	if (choice === 'mine') {
		return {
			patch: {
				savedMtimeMs: input.diskMtime,
				savedBytes: input.diskBytes,
				dirty: true
			}
		};
	}
	const base = input.tab.baseContent ?? '';
	const merged = merge3(base, input.ours, input.diskContent);
	// Arm CAS with disk cursors so clearing markers can ⌘S without Create-on-exists.
	// Markers never hit disk: saveDocument rejects hasConflictMarkers(content).
	return {
		patch: {
			baseContent: input.diskContent,
			savedMtimeMs: input.diskMtime,
			savedBytes: input.diskBytes,
			dirty: true
		},
		buffer: merged.text
	};
}

export async function resolveConflict(input: {
	tab: RailTab;
	ours: string;
	diskContent: string;
	diskMtime: number;
	diskBytes?: number;
	/** Non-blocking UI chooser (Electron has no window.prompt). */
	choose: (path: string) => Promise<ConflictChoice>;
}): Promise<ConflictApply | null> {
	const path = input.tab.filePath ?? input.tab.title;
	const choice = await input.choose(path);
	return applyConflictChoice(choice, input);
}

export async function saveDocument(input: {
	tab: RailTab;
	content: string;
	buffer: MonacoEditorHandle | null | undefined;
	/** Required when Save hits mtime conflict (Electron has no window.prompt). */
	choose: (path: string) => Promise<ConflictChoice>;
}): Promise<Partial<RailTab> | null> {
	const path = input.tab.filePath;
	if (!path) {
		window.alert('Untitled files cannot be saved yet — open a workspace path first.');
		return null;
	}
	if (hasConflictMarkers(input.content)) {
		window.alert('Resolve conflict markers (<<<<<<< / ======= / >>>>>>>) before saving.');
		return null;
	}
	const result = await window.fastIde.saveWorkspaceFile(
		path,
		input.content,
		input.tab.savedMtimeMs,
		input.tab.savedBytes
	);
	if (result.ok) {
		return {
			baseContent: input.content,
			savedMtimeMs: result.mtime,
			savedBytes: result.bytes,
			dirty: false
		};
	}
	if (result.code === 'busy') {
		window.alert(fsErrorMessage(result));
		return null;
	}
	if (result.code === 'missing') {
		window.alert('File was deleted on disk. Save again to recreate it.');
		return missingDocumentPatch();
	}
	if (result.code === 'conflict') {
		const got = await window.fastIde.getWorkspaceFile(path);
		if (!got.ok) {
			if (got.code === 'missing') {
				window.alert('File was deleted on disk. Save again to recreate it.');
				return missingDocumentPatch();
			}
			window.alert(fsErrorMessage(got));
			if (result.mtime != null) {
				return {savedMtimeMs: result.mtime, savedBytes: undefined};
			}
			return null;
		}
		const applied = await resolveConflict({
			tab: {...input.tab, savedMtimeMs: got.mtime, savedBytes: got.bytes},
			ours: input.content,
			diskContent: got.content,
			diskMtime: got.mtime,
			diskBytes: got.bytes,
			choose: input.choose
		});
		if (!applied) return null;
		if (applied.buffer != null) input.buffer?.setValue(applied.buffer);
		// Never auto-write after conflict — Merge markers must not hit disk; Use mine waits for ⌘S.
		return applied.patch;
	}
	window.alert(fsErrorMessage(result));
	return null;
}

export function isSelfEcho(
	event: {origin: string; connectionId?: string},
	bridgeConnectionId: string | null | undefined
): boolean {
	return event.origin === 'client' && !!bridgeConnectionId && event.connectionId === bridgeConnectionId;
}
