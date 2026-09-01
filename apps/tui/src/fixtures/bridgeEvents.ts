import type {BridgeEvent} from '../rpc/protocol.js';

/** Golden bridge event sequences for regression testing across UI phases. */
export const FIXTURE_READY: BridgeEvent = {
	type: 'ready',
	protocolVersion: 2,
	capabilities: ['structuredQuestions', 'agentEvents'],
	model: 'deepseek',
	maxTurns: 50,
	standalone: true,
	cwd: '/tmp/workspace',
	mode: 'bridge'
};

export const FIXTURE_COMMANDS_AVAILABLE: BridgeEvent = {
	type: 'commands_available',
	commands: [
		{name: 'model', description: 'Show or switch model', usage: '/model', available: true},
		{name: 'help', description: 'Show help', usage: '/help', available: true},
		{name: 'plan', description: 'Enter plan mode', usage: '/plan', available: true}
	]
};

export const FIXTURE_TURN_FLOW: BridgeEvent[] = [
	{type: 'input_accepted', turnId: 'turn_1', clientMessageId: 'client_1'},
	{type: 'turn_started', turnId: 'turn_1', clientMessageId: 'client_1', text: 'hello'},
	{type: 'thinking_started', turnId: 'turn_1', turn: 1, maxTurns: 50},
	{type: 'reasoning_delta', turnId: 'turn_1', text: 'thinking...'},
	{type: 'tool_started', turnId: 'turn_1', id: 'tool_1', tool: 'list_dir', args: {path: '.'}},
	{type: 'tool_finished', turnId: 'turn_1', id: 'tool_1', tool: 'list_dir', success: true, fields: {summary: 'app.js index.html'}},
	{type: 'assistant_delta', turnId: 'turn_1', text: 'Done.'},
	{type: 'turn_finished', turnId: 'turn_1', success: true}
];

export const FIXTURE_SHELL_TOOL: BridgeEvent[] = [
	{type: 'tool_started', turnId: 'turn_1', id: 'shell_1', tool: 'shell', args: {command: 'ls -la'}},
	{type: 'tool_output', turnId: 'turn_1', id: 'shell_1', tool: 'shell', stream: 'stdout', text: 'total 8\napp.js'},
	{type: 'tool_finished', turnId: 'turn_1', id: 'shell_1', tool: 'shell', success: true, fields: {exit: '0', duration: '120ms'}}
];

export const FIXTURE_APPROVAL: BridgeEvent[] = [
	{
		type: 'approval_requested',
		runId: 'run_1',
		turnId: 'turn_1',
		id: 'approval_1',
		tool: 'shell',
		description: 'Run destructive command',
		risk: 'Shell',
		context: 'rm -rf node_modules'
	},
	{type: 'approval_resolved', runId: 'run_1', turnId: 'turn_1', id: 'approval_1', approved: true}
];

export const FIXTURE_QUESTION: BridgeEvent[] = [
	{
		type: 'question_requested',
		runId: 'run_1',
		turnId: 'turn_1',
		id: 'question_1',
		title: 'Location',
		question: 'Where should I create the dashboard?',
		options: [
			{id: 'new_dir', label: 'New directory here', recommended: true},
			{id: 'current', label: 'Current repository'}
		],
		allowCustom: true
	},
	{
		type: 'question_answered',
		runId: 'run_1',
		turnId: 'turn_1',
		id: 'question_1',
		selectedOptionId: 'new_dir'
	}
];

export const FIXTURE_TASK_LIFECYCLE: BridgeEvent[] = [
	{type: 'agent_final_answer', runId: 'run_1', turnId: 'turn_1', text: 'Run complete.'},
	{type: 'run_done', runId: 'run_1', success: true, summary: 'Dashboard created'}
];

/**
 * Production shape: WorkspaceIO.grep → NoSuchFileException → tool_finished(success=false).
 * Includes Bridge double input_accepted (client id then server run UUID).
 */
export const FIXTURE_GREP_NOSUCHFILE: BridgeEvent[] = (() => {
	const missing = 'modules/runtime/engine/src/main/scala/ai/fastllm/agent/run/RunEntity.scala';
	const runId = '019fb909-f05d-7c58-981d-d4da32d2863d';
	const failedOut = `grep failed: NoSuchFileException: /tmp/ws/${missing}`;
	return [
		{type: 'input_accepted', turnId: 'client_1', clientMessageId: 'client_1'},
		{type: 'turn_started', turnId: 'client_1', clientMessageId: 'client_1', text: 'find RunEntity'},
		{type: 'thinking_started', turnId: 'client_1', turn: 1, maxTurns: 50},
		{type: 'input_accepted', turnId: runId, clientMessageId: 'client_1'},
		{
			type: 'tool_started',
			turnId: runId,
			id: 'tc-grep',
			tool: 'grep',
			args: {pattern: 'class RunEntity', path: missing}
		},
		{
			type: 'tool_finished',
			turnId: runId,
			id: 'tc-grep',
			tool: 'grep',
			success: false,
			fields: {status: 'failed', output: failedOut}
		},
		{type: 'assistant_delta', turnId: runId, text: 'path missing'},
		{type: 'turn_finished', turnId: runId, success: true},
		{type: 'run_done', runId, success: true, summary: 'path missing'}
	];
})();

export const FIXTURE_ALL_SEQUENCES = {
	ready: [FIXTURE_READY, FIXTURE_COMMANDS_AVAILABLE],
	turnFlow: FIXTURE_TURN_FLOW,
	shellTool: FIXTURE_SHELL_TOOL,
	approval: FIXTURE_APPROVAL,
	question: FIXTURE_QUESTION,
	taskLifecycle: FIXTURE_TASK_LIFECYCLE,
	grepNoSuchFile: FIXTURE_GREP_NOSUCHFILE
} as const;

/** Apply a sequence of bridge events through reducer for golden state tests. */
export function applyEventSequence<T>(
	initial: T,
	reducer: (state: T, action: {type: 'engine_event'; event: BridgeEvent}) => T,
	events: readonly BridgeEvent[]
): T {
	return events.reduce((state, event) => reducer(state, {type: 'engine_event', event}), initial);
}
