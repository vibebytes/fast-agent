/** Semantic chrome for Thought / File timeline rows (host formats via i18n). */

export type ThoughtChrome =
	| {kind: 'open'}
	| {kind: 'brief'}
	| {kind: 'done'}
	| {kind: 'duration'; seconds: number}
	| {kind: 'network'; phase: 'waiting' | 'retrying'; attempt?: number; maxAttempts?: number};

export type FileOp = 'edit' | 'write' | 'diff';

export type NetworkWait = {
	phase: 'retrying' | 'waiting';
	attempt?: number;
	maxAttempts?: number;
};

/**
 * Local English map — avoids `@fast-ide/i18n` `createI18n` (node:fs) in desktop
 * renderer bundles that import `@fast-ide/session-view`. Desktop uses `t()`.
 */
const en = {
	'session.thought.open': 'Thinking',
	'session.thought.brief': 'Thought briefly',
	'session.thought.done': 'Thought',
	'session.thought.duration': (seconds: number) => `Thought for ${seconds}s`,
	'session.network.waiting': 'Waiting for network',
	'session.network.reconnecting': 'Reconnecting',
	'session.network.reconnectingProgress': (attempt: number, maxAttempts: number) =>
		`Reconnecting (${attempt}/${maxAttempts})`,
	'session.file.edit': 'Edit',
	'session.file.write': 'Write',
	'session.file.diff': 'Diff'
} as const;

export function thoughtChromeFrom(
	text: string,
	opts: {
		open: boolean;
		startedAt?: number;
		sealedAt?: number;
		wait?: NetworkWait;
	}
): ThoughtChrome {
	if (opts.open && opts.wait) {
		return {
			kind: 'network',
			phase: opts.wait.phase,
			attempt: opts.wait.attempt,
			maxAttempts: opts.wait.maxAttempts
		};
	}
	if (opts.open) return {kind: 'open'};
	if (opts.startedAt != null && opts.sealedAt != null && opts.startedAt > 0) {
		const seconds = Math.max(1, Math.round((opts.sealedAt - opts.startedAt) / 1000));
		return {kind: 'duration', seconds};
	}
	const words = text.trim().split(/\s+/).filter(Boolean).length;
	if (words < 40) return {kind: 'brief'};
	return {kind: 'done'};
}

export function fileOp(tool: string): FileOp {
	const t = tool.toLowerCase();
	if (t.includes('diff') || t === 'git.diff') return 'diff';
	if (t.includes('edit') || t.includes('patch') || t.includes('replace')) return 'edit';
	return 'write';
}

/** English formatter for ink / Node hosts that do not run react-i18next. */
export function formatThoughtChromeEn(chrome: ThoughtChrome): string {
	switch (chrome.kind) {
		case 'open':
			return en['session.thought.open'];
		case 'brief':
			return en['session.thought.brief'];
		case 'done':
			return en['session.thought.done'];
		case 'duration':
			return en['session.thought.duration'](chrome.seconds);
		case 'network':
			if (chrome.phase === 'retrying' && chrome.attempt != null && chrome.maxAttempts != null) {
				return en['session.network.reconnectingProgress'](chrome.attempt, chrome.maxAttempts);
			}
			if (chrome.phase === 'retrying') return en['session.network.reconnecting'];
			return en['session.network.waiting'];
	}
}

export function formatFileOpEn(op: FileOp): string {
	return en[`session.file.${op}`];
}

/**
 * @deprecated Prefer `thoughtChromeFrom` + `formatThoughtChromeEn` / host `t()`.
 * Kept for ink `turnAdapter` English network chrome.
 */
export function networkWaitLabel(wait?: NetworkWait): string | undefined {
	if (!wait) return undefined;
	return formatThoughtChromeEn({
		kind: 'network',
		phase: wait.phase,
		attempt: wait.attempt,
		maxAttempts: wait.maxAttempts
	});
}
