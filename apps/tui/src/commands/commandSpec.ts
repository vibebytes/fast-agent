export type CommandAvailability = 'ready' | 'partial' | 'capability_unavailable' | 'hidden';
export type CommandOwner = 'ui' | 'engine' | 'hybrid';

export type CommandSpec = {
	name: string;
	aliases?: string[];
	owner: CommandOwner;
	availability: CommandAvailability;
	description: string;
	usage: string;
	capability?: string;
	requiresArgs?: boolean;
	sideEffect?: 'none' | 'session-reset' | 'ui-clear' | 'resend-last-user' | 'rerun-last-failed' | 'continue-run';
};

/** Single source of truth for slash command contract in fast-ink. */
export const COMMAND_SPECS: CommandSpec[] = [
	{name: 'help', owner: 'ui', availability: 'ready', description: 'Show help dialog', usage: '/help'},
	{name: 'shortcuts', owner: 'ui', availability: 'ready', description: 'Show keyboard shortcuts', usage: '/shortcuts'},
	{name: 'theme', owner: 'ui', availability: 'ready', description: 'Open theme dialog', usage: '/theme'},
	{name: 'footer', owner: 'ui', availability: 'ready', description: 'Configure footer items', usage: '/footer'},
	{name: 'thinking', owner: 'ui', availability: 'ready', description: 'Cycle reasoning display (compact/full/off)', usage: '/thinking'},
	{name: 'clear-screen', owner: 'ui', availability: 'ready', description: 'Clear screen content only', usage: '/clear-screen', sideEffect: 'ui-clear'},
	{name: 'clear-errors', owner: 'ui', availability: 'ready', description: 'Clear all error messages displayed below the input area', usage: '/clear-errors'},
	{name: 'debug-events', owner: 'ui', availability: 'ready', description: 'Show debug event log', usage: '/debug-events'},
	{name: 'tui', owner: 'ui', availability: 'ready', description: 'Switch renderer mode (fullscreen/inline)', usage: '/tui [fullscreen|inline]'},
	{name: 'dump-frame', owner: 'ui', availability: 'ready', description: 'Dump current Ink frame for debugging', usage: '/dump-frame [path]'},
	{name: 'record-frames', owner: 'ui', availability: 'ready', description: 'Start/stop frame recording', usage: '/record-frames [path|stop]'},
	{name: 'debug', owner: 'hybrid', availability: 'ready', description: 'Open the LLM debug web page in your browser', usage: '/debug [on|off]'},
	{name: 'exit', owner: 'ui', availability: 'ready', description: 'Exit CLI', usage: '/exit', aliases: ['quit']},
	{name: 'retry', owner: 'ui', availability: 'ready', description: 'Retry last message', usage: '/retry', sideEffect: 'resend-last-user'},
	{name: 'rerun', owner: 'ui', availability: 'ready', description: 'Rerun the last failed run (direct replace)', usage: '/rerun', aliases: ['r'], sideEffect: 'rerun-last-failed'},
	{name: 'continue', owner: 'ui', availability: 'ready', description: 'Continue from the previous answer', usage: '/continue', sideEffect: 'continue-run'},
	{name: 'model', owner: 'engine', availability: 'ready', description: 'Show or switch model', usage: '/model [name]'},
	{name: 'new', owner: 'hybrid', availability: 'ready', description: 'Start new session', usage: '/new [name]', aliases: ['reset'], sideEffect: 'ui-clear'},
	{name: 'clear', owner: 'hybrid', availability: 'ready', description: 'Clear conversation and session', usage: '/clear', sideEffect: 'ui-clear'},
	{name: 'history', owner: 'engine', availability: 'ready', description: 'Show conversation history', usage: '/history'},
	{name: 'sessions', owner: 'engine', availability: 'ready', description: 'List sessions', usage: '/sessions'},
	{name: 'resume', owner: 'hybrid', availability: 'ready', description: 'Resume a saved session', usage: '/resume [latest|<id>]'},
	{name: 'usage', owner: 'engine', availability: 'ready', description: 'Show token usage', usage: '/usage'},
	{name: 'rule', owner: 'engine', availability: 'ready', description: 'Manage long-term project rules', usage: '/rule add <text> | /rule list | /rule remove <id>'},
	{name: 'compact', owner: 'engine', availability: 'ready', description: 'Compress conversation context', usage: '/compact', aliases: ['compress']},
	{name: 'context', owner: 'engine', availability: 'ready', description: 'Inspect current context state', usage: '/context', aliases: ['ctx']},
	{name: 'copy', owner: 'engine', availability: 'ready', description: 'Copy last response', usage: '/copy'},
	{name: 'undo', owner: 'hybrid', availability: 'ready', description: 'Undo last exchange', usage: '/undo'},
	{name: 'title', owner: 'engine', availability: 'ready', description: 'Set session title', usage: '/title <name>', requiresArgs: true},
	{name: 'mode', owner: 'engine', availability: 'ready', description: 'Set sticky RunMode', usage: '/mode <agent|plan|ask|yolo>', requiresArgs: true},
	{name: 'exit-plan', owner: 'engine', availability: 'ready', description: 'Exit plan mode (alias of /mode agent)', usage: '/exit-plan', aliases: ['exit_plan']},
	{name: 'sandbox', owner: 'engine', availability: 'ready', description: 'Show or configure the sandbox', usage: '/sandbox status | /sandbox mode [seatbelt|srt|off] | /sandbox network on|off|status|allow <domain...>'},
	{name: 'agents', owner: 'engine', availability: 'ready', description: 'List active agents', usage: '/agents'},
	{name: 'nodes', owner: 'engine', availability: 'ready', description: 'Show cluster nodes', usage: '/nodes'},
	{name: 'task', owner: 'engine', availability: 'partial', description: 'Run detail and actions', usage: '/task <runId> [logs|cancel|retry|replay]', capability: 'taskManagement', requiresArgs: true},
	{name: 'tasks', owner: 'engine', availability: 'partial', description: 'List tasks from local audit', usage: '/tasks', capability: 'taskListing'},
	{name: 'inspect', owner: 'engine', availability: 'partial', description: 'Inspect run state', usage: '/inspect <runId>', capability: 'taskInspection', requiresArgs: true},
	{name: 'cancel', owner: 'engine', availability: 'partial', description: 'Cancel a running run', usage: '/cancel <runId>', capability: 'taskCancellation', requiresArgs: true},
	{name: 'watch', owner: 'engine', availability: 'capability_unavailable', description: 'Watch a running run', usage: '/watch <runId>', capability: 'taskEventSubscription', requiresArgs: true},
	{name: 'run', owner: 'engine', availability: 'capability_unavailable', description: 'Execute an agent task', usage: '/run <agent> <input>', capability: 'clusterTaskExecution', requiresArgs: true},
	{name: 'deploy', owner: 'engine', availability: 'hidden', description: 'Deploy an agent blueprint', usage: '/deploy <blueprint>', capability: 'clusterDeployment', requiresArgs: true},
	{name: 'register', owner: 'engine', availability: 'capability_unavailable', description: 'Register a skill', usage: '/register <skill.md>', capability: 'skillRegistry', requiresArgs: true},
	{name: 'skills', owner: 'engine', availability: 'ready', description: 'List Catalog skills (L0)', usage: '/skills [--verbose]'},
	{name: 'confirmgoal', owner: 'engine', availability: 'ready', description: 'Confirm awaiting Goal and start workflow', usage: '/ConfirmGoal [goal_id]', aliases: ['confirm-goal']},
	{name: 'scale', owner: 'engine', availability: 'hidden', description: 'Scale cluster nodes', usage: '/scale <n>', capability: 'clusterScaling', requiresArgs: true}
];

const specByName = new Map<string, CommandSpec>();
for (const spec of COMMAND_SPECS) {
	specByName.set(spec.name, spec);
	for (const alias of spec.aliases ?? []) {
		specByName.set(alias, spec);
	}
}

export function findCommandSpec(name: string): CommandSpec | undefined {
	return specByName.get(name);
}

export function visibleCommandSpecs(): CommandSpec[] {
	const seen = new Set<string>();
	return COMMAND_SPECS.filter(spec => {
		if (spec.availability === 'hidden') return false;
		if (seen.has(spec.name)) return false;
		seen.add(spec.name);
		return true;
	});
}

export function uiOnlyCommandNames(): string[] {
	return visibleCommandSpecs().filter(spec => spec.owner === 'ui').map(spec => spec.name);
}

export function engineCommandNames(): string[] {
	return visibleCommandSpecs()
		.filter(spec => spec.owner === 'engine' || spec.owner === 'hybrid')
		.map(spec => spec.name);
}

export function commandSpecToInfo(spec: CommandSpec): import('../state/model.js').CommandInfo {
	return {
		name: spec.name,
		description: spec.description,
		usage: spec.usage,
		available: spec.availability === 'ready' || spec.availability === 'partial',
		availability: spec.availability,
		capability: spec.capability
	};
}

export function mergeEngineCommandInfo(
	builtin: CommandSpec[],
	engineAvailable: import('../state/model.js').CommandInfo[]
): import('../state/model.js').CommandInfo[] {
	const byName = new Map(
		builtin
			.filter(spec => spec.owner !== 'ui' && spec.availability !== 'hidden')
			.map(spec => [spec.name, commandSpecToInfo(spec)])
	);
	for (const info of engineAvailable) {
		const existing = byName.get(info.name);
		if (existing) {
			byName.set(info.name, {
				...existing,
				description: info.description || existing.description,
				usage: info.usage || existing.usage,
				available: info.available ?? existing.available,
				availability: info.availability ?? existing.availability,
				capability: info.capability ?? existing.capability
			});
		} else if (info.availability !== 'hidden') {
			byName.set(info.name, info);
		}
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
