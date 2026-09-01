import {isBridgeFixedCommand} from './bridgeFixedCommands.js';

/** IDE-local only — not in Bridge fixed table. */
const IDE_LOCAL_SLASH = new Set(['help']);

export type SlashRoute =
	| {kind: 'slash'; name: string; args: string}
	| {kind: 'message'; text: string};

export function parseSlashInput(text: string): {name: string; args: string} | null {
	const m = text.trim().match(/^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i);
	if (!m?.[1]) return null;
	return {name: m[1], args: (m[2] ?? '').trim()};
}

/**
 * Legacy persisted user text (pre SkillEnvelope mount):
 * `[Skill: name]\n{instructions}\n\n---\n\n{taskText}`
 * New SkillSlash only stores `/$name [args]`; keep this for restore/compat.
 * Transcript UI shows chip + taskText, never the skill body.
 */
export function parseSkillInjectedMessage(text: string): {name: string; args: string} | null {
	const trimmed = text.trimStart();
	const header = trimmed.match(/^\[Skill:\s*([^\]]+)\]\s*(?:\r?\n|$)/);
	if (!header?.[1]) return null;
	const name = header[1].trim();
	if (!name) return null;
	const rest = trimmed.slice(header[0].length);
	const sep = '\n\n---\n\n';
	const idx = rest.lastIndexOf(sep);
	const args = idx >= 0 ? rest.slice(idx + sep.length).trim() : '';
	return {name, args};
}

/**
 * Pre-fix SkillSlash bug: Engine persisted model postSubmitPrompt (with goal/loop nudge)
 * instead of `/$name args`. Recover chip + user args for restore of those rows.
 */
const LEAKED_GOAL_NUDGE =
	/\n\nCall the goal tool[\s\S]*?Do not research, shell, or write the deliverable in this turn\.\s*$/;
const LEAKED_LOOP_NUDGE =
	/\n\nCall the schedule tool with action=create \(kind=session_loop\) now\. Do not execute the recurring task yourself\.\s*$/;

function parseLeakedPostSubmitPrompt(text: string): {name: string; args: string} | null {
	const trimmed = text.trim();
	if (LEAKED_GOAL_NUDGE.test(trimmed)) {
		const base = trimmed.replace(LEAKED_GOAL_NUDGE, '').trim();
		const args = /^Use the skill goal$/i.test(base) ? '' : base;
		return {name: 'goal', args};
	}
	if (LEAKED_LOOP_NUDGE.test(trimmed)) {
		const base = trimmed.replace(LEAKED_LOOP_NUDGE, '').trim();
		const args = /^Use the skill loop$/i.test(base) ? '' : base;
		return {name: 'loop', args};
	}
	return null;
}

/** Slash `/name args` or legacy `[Skill: name]…` — for transcript chip display. */
export function parseUserSkillDisplay(text: string): {name: string; args: string} | null {
	return parseSlashInput(text) ?? parseSkillInjectedMessage(text) ?? parseLeakedPostSubmitPrompt(text);
}

/** One-line chip preview: `/$name` or `/$name $args`. Null when not a skill/slash display. */
export function formatUserSkillDisplayLine(text: string): string | null {
	const skill = parseUserSkillDisplay(text);
	if (!skill) return null;
	return skill.args.length > 0 ? `/${skill.name} ${skill.args}` : `/${skill.name}`;
}

/**
 * Allowlist gate: Host-local + Bridge fixed + known skill names → slash/command.
 * Unknown `/xxx` → ordinary user message.
 */
export function resolveSlashRoute(text: string, skillNames: Iterable<string>): SlashRoute {
	const trimmed = text.trim();
	const parsed = parseSlashInput(trimmed);
	if (!parsed) return {kind: 'message', text: trimmed};
	const name = parsed.name.toLowerCase();
	const skills = new Set(
		[...skillNames].map(n => n.trim().toLowerCase()).filter(Boolean)
	);
	if (IDE_LOCAL_SLASH.has(name) || isBridgeFixedCommand(name) || skills.has(name)) {
		return {kind: 'slash', name, args: parsed.args};
	}
	return {kind: 'message', text: trimmed};
}

/** True when name is a SkillSlash candidate (not Host-local / Bridge fixed). */
export function isSkillSlashName(name: string): boolean {
	const n = name.trim().toLowerCase();
	return n.length > 0 && !IDE_LOCAL_SLASH.has(n) && !isBridgeFixedCommand(n);
}

export function isIdeLocalSlash(name: string): boolean {
	return IDE_LOCAL_SLASH.has(name.trim().toLowerCase());
}
