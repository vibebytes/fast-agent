import {cn} from '@fast-ide/ui/lib/utils';
import {
	CalendarClock,
	FileText,
	Folder,
	GitBranch,
	GitCompare,
	Globe,
	PenLine,
	TerminalSquare,
	type LucideIcon
} from 'lucide-react';
import {createElement, type ReactElement} from 'react';
import {shellT as t} from './i18n/t';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export type RailTabKind =
	| 'files'
	| 'changes'
	| 'diff'
	| 'browser'
	| 'document'
	| 'canvas'
	| 'terminal'
	| 'context'
	| 'scheduled';

export type RailTab = {
	id: string;
	kind: RailTabKind;
	title: string;
	pinned?: boolean;
	/** Project-relative path when opened from the file tree. */
	filePath?: string;
	url?: string;
	/**
	 * Untitled / seed text only. Disk Document body lives in the Monaco model —
	 * do not patch this on every keystroke.
	 */
	body?: string;
	/** Host stamp (bare 12-hex) when opened from a registered workspace. */
	workspaceId?: string;
	/** Disk mtime cursor — next SaveWorkspaceFile `mtime` CAS value. */
	savedMtimeMs?: number;
	/** Disk size cursor — paired with savedMtimeMs for coarse-FS CAS. */
	savedBytes?: number;
	/** True when Monaco buffer differs from last open/save. */
	dirty?: boolean;
	/** Full-text snapshot at last open/save — 3-way merge base. */
	baseContent?: string;
	/** Bumps to remount Monaco when disk content is reloaded into the model. */
	editorEpoch?: number;
	/** The agent change a `diff` tab is reviewing; its content is fetched, never stored here. */
	changeId?: string;
	/** Cursor/view position requested by file-click links. */
	targetPosition?: {line: number; endLine?: number; nonce: number};
};

/** `files` is pinned and `diff` needs a change to review, so neither is offered as a blank tab. */
export type NewTabKind = Exclude<RailTabKind, 'files' | 'diff'>;

type NewTabOption = {
	kind: NewTabKind;
	label: string;
	hint: string;
	icon: typeof FileText;
};

export const FILES_TAB_ID = 'rail-files';

/** Prefer `filesTab()` / `railTabTitle()` at render so labels follow locale. */
export const FILES_TAB: RailTab = {
	id: FILES_TAB_ID,
	kind: 'files',
	title: 'Files',
	pinned: true
};

export function filesTab(): RailTab {
	return {
		id: FILES_TAB_ID,
		kind: 'files',
		title: t('shell.tabs.files'),
		pinned: true
	};
}

/** Catalog title for kind-backed tabs; keeps custom document/file titles as stored. */
export function railTabTitle(tab: RailTab, tr: Translate = t): string {
	switch (tab.kind) {
		case 'files':
			return tr('shell.tabs.files');
		case 'changes':
			return tr('shell.tabs.changes');
		case 'browser':
			return tr('shell.tabs.browser');
		case 'context':
			return tr('shell.tabs.context');
		case 'scheduled':
			return tr('shell.tabs.scheduled');
		case 'diff':
		case 'document':
		case 'canvas':
		case 'terminal':
			return tab.title;
	}
}

/** Stable id so openers can focus the tab without waiting on a `setTabs` updater. */
export function diffTabId(changeId: string): string {
	return `diff:${changeId}`;
}

/** A review diff tab, named after the file so it reads like the document tab beside it. */
export function diffTab(changeId: string, filePath: string): RailTab {
	return {
		id: diffTabId(changeId),
		kind: 'diff',
		title: filePath.split(/[/\\]/).pop() ?? filePath,
		filePath,
		changeId
	};
}

export function newTabOptions(tr: Translate = t): NewTabOption[] {
	return [
		{kind: 'document', label: tr('shell.tabs.file'), hint: tr('shell.tabs.fileHint'), icon: FileText},
		{
			kind: 'terminal',
			label: tr('shell.tabs.terminal'),
			hint: tr('shell.tabs.terminalHint'),
			icon: TerminalSquare
		},
		{kind: 'browser', label: tr('shell.tabs.browser'), hint: tr('shell.tabs.browserHint'), icon: Globe},
		{
			kind: 'changes',
			label: tr('shell.tabs.changes'),
			hint: tr('shell.tabs.changesHint'),
			icon: GitBranch
		},
		{kind: 'canvas', label: tr('shell.tabs.canvas'), hint: tr('shell.tabs.canvasHint'), icon: PenLine},
		{
			kind: 'context',
			label: tr('shell.tabs.context'),
			hint: tr('shell.tabs.contextHint'),
			icon: FileText
		},
		{
			kind: 'scheduled',
			label: tr('shell.tabs.scheduled'),
			hint: tr('shell.tabs.scheduledHint'),
			icon: CalendarClock
		}
	];
}

/** @deprecated prefer `newTabOptions()` so labels follow locale */
export const NEW_TAB_OPTIONS: NewTabOption[] = newTabOptions();

export function newTabId(): string {
	return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createRailTab(kind: NewTabKind, index = 1): RailTab {
	switch (kind) {
		case 'changes':
			return {id: newTabId(), kind, title: t('shell.tabs.changes')};
		case 'browser':
			return {id: newTabId(), kind, title: t('shell.tabs.browser'), url: 'https://'};
		case 'document':
			return {
				id: newTabId(),
				kind,
				title: index > 1 ? t('shell.tabs.untitledN', {index}) : t('shell.tabs.untitled'),
				body: '',
				baseContent: '',
				dirty: false
			};
		case 'canvas':
			return {
				id: newTabId(),
				kind,
				title: index > 1 ? t('shell.tabs.canvasN', {index}) : t('shell.tabs.canvas')
			};
		case 'terminal':
			return {
				id: newTabId(),
				kind,
				title: index > 1 ? t('shell.tabs.zshN', {index}) : t('shell.tabs.zsh')
			};
		case 'context':
			return {id: newTabId(), kind, title: t('shell.tabs.context')};
		case 'scheduled':
			return {id: newTabId(), kind, title: t('shell.tabs.scheduled')};
	}
}

export function TabKindIcon({kind, className}: {kind: RailTabKind; className?: string}): ReactElement {
	const cls = cn('size-3.5 shrink-0', className);
	const icon = ((): LucideIcon => {
		switch (kind) {
			case 'files':
				return Folder;
			case 'changes':
				return GitBranch;
			case 'diff':
				return GitCompare;
			case 'browser':
				return Globe;
			case 'document':
				return FileText;
			case 'canvas':
				return PenLine;
			case 'terminal':
				return TerminalSquare;
			case 'context':
				return FileText;
			case 'scheduled':
				return CalendarClock;
		}
	})();
	return createElement(icon, {className: cls});
}

export function shortPath(path: string): string {
	if (path.length <= 42) return path;
	return `…${path.slice(-40)}`;
}
