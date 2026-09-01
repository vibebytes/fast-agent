import {isBridgeFixedCommand} from '@fastllm/bridge-protocol';
import type {CommandSpec} from './commandSpec.js';
import {findCommandSpec} from './commandSpec.js';
import type {UiState} from '../state/model.js';

export type RouteDecision =
	| {kind: 'quit'}
	| {kind: 'ui'; spec: CommandSpec; args: string}
	| {kind: 'retry'; lastUserText: string}
	| {kind: 'rerun'; runId: string}
	| {kind: 'continue'}
	| {kind: 'blocked'; reason: string}
	| {kind: 'hybrid'; name: string; args: string; uiClear?: boolean; uiUndo?: boolean; uiDebug?: boolean; uiSessionBrowser?: boolean}
	| {kind: 'engine'; name: string; args: string}
	/** Forward to Bridge for SkillSlash resolve (no localTurn seed — Bridge emits tool turn). */
	| {kind: 'skillCandidate'; name: string; args: string}
	| {kind: 'unknown'; name: string};

/** Newest error assistant entry — the rerun/continue target. */
export function lastFailedEntry(state: UiState) {
	return [...state.transcript.entries]
		.reverse()
		.find(e => e.role === 'assistant' && e.status === 'error');
}

/**
 * Bare r/c quick keys (doc §8): active only when "last terminal + idle".
 * While running both are grayed out; continue additionally needs accepted turns.
 */
export function quickActionAvailability(state: UiState): {
	retryRunId: string | null;
	continueReady: boolean;
} {
	if (state.running) return {retryRunId: null, continueReady: false};
	const failed = lastFailedEntry(state);
	if (!failed) return {retryRunId: null, continueReady: false};
	// The failure must be the newest assistant terminal — stale errors deep in
	// history stay grayed once a later run finished.
	const lastAssistant = [...state.transcript.entries]
		.reverse()
		.find(e => e.role === 'assistant');
	if (!lastAssistant || lastAssistant.id !== failed.id) {
		return {retryRunId: null, continueReady: false};
	}
	// Rerun targets the ENGINE run id observed via run_failed — never the display
	// entry id (`assistant-<clientMessageId>`), which the daemon never recorded.
	const failure =
		state.lastFailure && state.lastFailure.runId === failed.turnId ? state.lastFailure : null;
	return {
		retryRunId: failure?.runId ?? null,
		continueReady: (failure?.acceptedTurns ?? 0) > 0
	};
}

export function routeSlashCommand(text: string, state: UiState): RouteDecision | undefined {
	const parsed = parseSlash(text);
	if (!parsed) return undefined;

	const spec = findCommandSpec(parsed.name);
	if (!spec) {
		const name = parsed.name.toLowerCase();
		// Bridge fixed names not in ink COMMAND_SPECS (e.g. delete-session).
		if (isBridgeFixedCommand(name)) {
			return {kind: 'engine', name, args: parsed.args};
		}
		// Catalog skill (commands_available) → SkillSlash; else ordinary message.
		const skill = state.commands.some(
			c => c.name.toLowerCase() === name && c.available !== false
		);
		if (skill) return {kind: 'skillCandidate', name: parsed.name, args: parsed.args};
		return undefined;
	}

	if (spec.name === 'exit' || spec.name === 'quit') {
		return {kind: 'quit'};
	}

	if (spec.sideEffect === 'rerun-last-failed') {
		const avail = quickActionAvailability(state);
		if (!avail.retryRunId) {
			return lastFailedEntry(state)
				? {kind: 'blocked', reason: '/rerun 没有可重跑的失败轮次（仅最近一次失败可重试）'}
				: {kind: 'ui', spec, args: parsed.args};
		}
		return {kind: 'rerun', runId: avail.retryRunId};
	}

	if (spec.sideEffect === 'continue-run') {
		const avail = quickActionAvailability(state);
		if (!avail.retryRunId) return {kind: 'blocked', reason: '/continue 没有可继续的失败轮次'};
		if (!avail.continueReady) {
			return {kind: 'blocked', reason: '/continue 首轮即失败，无内容可续；请使用 /rerun 重跑'};
		}
		return {kind: 'continue'};
	}

	if (spec.sideEffect === 'resend-last-user') {
		const lastUserText =
			[...state.transcript.entries].reverse().find(e => e.role === 'user' && e.text.trim().length > 0)?.text
			?? [...state.localTurns].reverse().find(t => t.userText.trim().length > 0)?.userText;
		if (!lastUserText) return {kind: 'ui', spec, args: parsed.args};
		return {kind: 'retry', lastUserText};
	}

	if (spec.owner === 'ui') {
		return {kind: 'ui', spec, args: parsed.args};
	}

	if (spec.owner === 'hybrid') {
		if (spec.name === 'debug') {
			const args = parsed.args.trim() || (state.debugVisible ? 'off' : 'on');
			return {kind: 'hybrid', name: 'debug', args, uiDebug: true};
		}
		if (spec.name === 'resume' && parsed.args.trim().length === 0) {
			return {kind: 'hybrid', name: 'resume', args: '', uiSessionBrowser: true};
		}
		return {
			kind: 'hybrid',
			name: spec.name === 'reset' ? 'new' : spec.name,
			args: parsed.args,
			uiClear: spec.sideEffect === 'ui-clear',
			uiUndo: spec.name === 'undo'
		};
	}

	return {kind: 'engine', name: spec.name, args: parsed.args};
}

function parseSlash(text: string): {name: string; args: string} | undefined {
	if (!text.startsWith('/')) return undefined;
	const trimmed = text.slice(1).trim();
	if (trimmed.length === 0) return undefined;
	const [name, ...rest] = trimmed.split(/\s+/);
	return {name: name ?? '', args: rest.join(' ')};
}
