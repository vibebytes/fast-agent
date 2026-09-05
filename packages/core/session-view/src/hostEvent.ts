import type {MentionChip} from './wire.js';

export type FollowUpQueueItem = {id: string; text: string; mentions?: MentionChip[]};

export function parseMentionsJson(raw: string): MentionChip[] {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((m): m is Record<string, unknown> => m != null && typeof m === 'object')
			.map(m => ({
				kind: String(m.kind ?? ''),
				locator: String(m.locator ?? ''),
				...(typeof m.displayName === 'string' ? {displayName: m.displayName} : {}),
				...(typeof m.ref === 'string' ? {ref: m.ref} : {}),
				...(typeof m.entity === 'string' ? {entity: m.entity} : {})
			}))
			.filter(m => m.kind.length > 0 && m.locator.length > 0);
	} catch (err) {
		console.error('[follow_up_changed] bad mentionsJson', err);
		return [];
	}
}

export function followUpQueueFrom(itemsJson: string): FollowUpQueueItem[] {
	try {
		const parsed = JSON.parse(itemsJson) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((m): m is Record<string, unknown> => m != null && typeof m === 'object')
			.map(m => ({
				id: String(m.id ?? ''),
				text: String(m.text ?? ''),
				...(typeof m.mentionsJson === 'string' && m.mentionsJson
					? {mentions: parseMentionsJson(m.mentionsJson)}
					: {})
			}))
			.filter(m => m.id.length > 0 && m.text.length > 0)
			.sort((a, b) => a.id.localeCompare(b.id));
	} catch (err) {
		console.error('[follow_up_changed] bad itemsJson', err);
		return [];
	}
}

export function parseEngineKind(raw?: string | null): 'fast' | 'dsh' {
	return (raw ?? '').trim().toLowerCase() === 'dsh' ? 'dsh' : 'fast';
}

export type SessionTitleReply = {status: string; message?: string; title?: string};

export type TitleReplyDecision =
	| {kind: 'revert'; previous: string; notice: string}
	| {kind: 'ok'; resolvedTitle: string; hadPending: boolean};

export function sessionTitleDecision(
	reply: SessionTitleReply,
	pending?: {previous: string} | null
): TitleReplyDecision | null {
	if (reply.status === 'error') {
		if (!pending) return null;
		return {
			kind: 'revert',
			previous: pending.previous,
			notice: reply.message ?? 'errors.session.rename_failed'
		};
	}
	const resolvedTitle = typeof reply.title === 'string' ? reply.title.trim() : '';
	return {kind: 'ok', resolvedTitle, hadPending: pending != null};
}

const BUILTIN_COMMAND_NAMES: readonly string[] = ['skills', 'model', 'debug', 'sessions', 'history'];

/**
 * SkillSlash / unknown slash failures arrive after task:send already returned —
 * paint into the owning Task (by sessionId) so the UI is never silently empty.
 * Host command results (skills/model/debug/sessions/history) are handled elsewhere.
 */
export function paintsCommandError(
	name: string | undefined,
	status: string,
	message: string | undefined
): boolean {
	if (status !== 'error' || !message?.trim()) return false;
	return (
		name === 'skill_view' ||
		message.includes('Unknown command:') ||
		message.includes('No active session') ||
		message.includes('Failed to persist skill_view') ||
		(typeof name === 'string' && name.length > 0 && !BUILTIN_COMMAND_NAMES.includes(name))
	);
}

/** Old Engine lacks SkillSlash; a host-known skill failing with `Unknown command:` means that. */
export function skillErrorNeedsEngineSlashHint(
	name: string | undefined,
	message: string,
	known: boolean
): boolean {
	const key = (name ?? '').trim();
	if (!key || key === 'skill_view' || key === 'skills') return false;
	if (!message.includes('Unknown command:')) return false;
	if (message.includes('(')) return false;
	return known;
}
