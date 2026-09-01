/**
 * Bridge `{type:command}` names handled by Engine `CommandLoop.handleLocalCommand`
 * fixed branches (before SkillSlash `other`). Keep in sync with Scala
 * `BridgeFixedCommands.Names` — both sides lock the sorted list in tests.
 *
 * Thin Clients use this ∪ Catalog skill names as the slash→command allowlist.
 * IDE-local-only names (e.g. `help`) are not listed here.
 *
 * Note: `plan` is NOT fixed — it is the builtin plan SkillSlash (sticky RunMode sync).
 * RunMode sticky switch is `/mode <agent|plan|ask|yolo>` (not bare `/agent`/`/ask`/`/yolo`).
 * Builtin skill `/agent` creates a Team member Agent.
 */
export const BRIDGE_FIXED_COMMAND_NAMES = [
	'agents',
	'clear',
	'confirm-goal',
	'confirmgoal',
	'context',
	'copy',
	'ctx',
	'debug',
	'delete-session',
	'exit-plan',
	'exit_plan',
	'history',
	'mode',
	'model',
	'new',
	'nodes',
	'reset',
	'restore',
	'resume',
	'rule',
	'sandbox',
	'sessions',
	'skills',
	'tasks',
	'title',
	'usage'
] as const;

export type BridgeFixedCommandName = (typeof BRIDGE_FIXED_COMMAND_NAMES)[number];

const FIXED = new Set<string>(BRIDGE_FIXED_COMMAND_NAMES);

export function isBridgeFixedCommand(name: string): boolean {
	return FIXED.has(name.trim().toLowerCase());
}
