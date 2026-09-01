/**
 * Minimal bridge-protocol mock engine for end-to-end TUI smoke tests.
 * Speaks NDJSON over stdio exactly like the Scala engine in bridge mode.
 */
import {createInterface} from 'node:readline';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let eventSeq = 0;
const emit = event => process.stdout.write(`${JSON.stringify({...event, eventSeq: ++eventSeq})}\n`);

const unixBoot = process.env.FAST_MOCK_UNIX_BOOTSTRAP === '1';
const earlyMeta = process.env.FAST_MOCK_UNIX_EARLY_META === '1';
const createDelayMs = Number(process.env.FAST_MOCK_UNIX_CREATE_DELAY_MS ?? '0');

const readyEvent = epoch => ({
	type: 'ready',
	protocolVersion: 2,
	engineEpoch: epoch,
	capabilities: ['structuredQuestions'],
	model: 'mock-model',
	modelDisplay: 'Mock Model',
	maxTurns: 50,
	standalone: true,
	cwd: process.cwd(),
	mode: 'bridge',
	// Host boot session — unix Thin Client strips this; mock keeps it for legacy stdio tests.
	sessionId: 'mock-session'
});
emit(readyEvent('mock-epoch-1'));
emit({
	type: 'commands_available',
	commands: [
		{name: 'help', description: 'Show help', usage: '/help', available: true}
	]
});
if (unixBoot && earlyMeta) {
	emit({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default',
		projects: [
			{
				id: 'mock-proj-1',
				projectType: 'coding',
				displayName: 'mock',
				status: 'active',
				isDefault: false
			}
		],
		sessionsByProjectId: {'mock-proj-1': []}
	});
}

let turnCounter = 0;
const pendingApprovals = new Map();
const pendingQuestions = new Map();
const pendingClarifications = new Map();

/**
 * Mirrors the real "deep analysis" flow that produced ghost Thinking lines:
 * long streamed thinking → 6 parallel shells → second long thinking phase
 * (many reasoning deltas while the spinner animates) → final answer.
 */
async function runDeepAnalysisTurn(command) {
	turnCounter += 1;
	const turnId = `turn_${turnCounter}`;
	emit({type: 'input_accepted', turnId, clientMessageId: command.clientMessageId});
	emit({type: 'turn_started', turnId, clientMessageId: command.clientMessageId, text: command.text});
	emit({type: 'thinking_started', turnId, turn: turnCounter, maxTurns: 50});

	// Real engines stream reasoning as ONE long paragraph with no newlines —
	// a single logical line that wraps to 10+ terminal rows. Mimic that.
	for (let i = 0; i < 12; i += 1) {
		emit({type: 'reasoning_delta', turnId, text: `深度分析步骤${i}需要收集系统性能数据包括处理器内存磁盘网络等指标并且对比历史基线，`});
		await sleep(80);
	}

	const cmds = ['uptime', 'top -l 1 -n 15', 'vm_stat', 'sysctl hw.ncpu', 'df -h /', 'iostat -n 1'];
	for (const [index, cmd] of cmds.entries()) {
		emit({type: 'tool_started', turnId, id: `ghost_tool_${index}`, tool: 'shell', args: {command: cmd}});
	}
	await sleep(120);
	for (const [index] of cmds.entries()) {
		emit({type: 'tool_output', turnId, id: `ghost_tool_${index}`, tool: 'shell', stream: 'stdout', text: `metric-${index}-a\nmetric-${index}-b\nmetric-${index}-c`});
	}
	await sleep(120);
	for (const [index] of cmds.entries()) {
		emit({type: 'tool_finished', turnId, id: `ghost_tool_${index}`, tool: 'shell', success: true, fields: {exit: '0', duration: `${30 + index}ms`}});
	}

	// Second thinking phase: spinner runs for ~2.5s while one giant unbroken
	// CJK paragraph keeps growing — the window where ghost frames accumulated.
	for (let i = 0; i < 25; i += 1) {
		emit({type: 'reasoning_delta', turnId, text: `汇总阶段${i}综合负载内存压力与磁盘吞吐共同评估当前瓶颈所在并制定优化建议，`});
		await sleep(100);
	}

	emit({type: 'assistant_delta', turnId, text: 'GHOST-FINAL-DONE 性能分析完成。'});
	emit({type: 'final_answer', turnId, text: 'GHOST-FINAL-DONE 性能分析完成。'});
	emit({type: 'turn_usage', turnId, turn: turnCounter, tokensUsed: 256});
	emit({type: 'turn_finished', turnId, success: true});
}

async function runTurn(command) {
	turnCounter += 1;
	const turnId = `turn_${turnCounter}`;
	emit({type: 'input_accepted', turnId, clientMessageId: command.clientMessageId});
	emit({type: 'turn_started', turnId, clientMessageId: command.clientMessageId, text: command.text});
	emit({type: 'thinking_started', turnId, turn: turnCounter, maxTurns: 50});
	await sleep(30);
	emit({type: 'reasoning_delta', turnId, text: '先分析一下用户的请求，然后执行一个工具调用。'});
	await sleep(30);
	emit({type: 'assistant_delta', turnId, text: '收到，开始处理。\n\n第一步：检查目录。\n\n'});
	await sleep(30);
	emit({type: 'tool_started', turnId, id: `tool_${turnCounter}`, tool: 'shell', args: {command: 'ls -la'}});
	await sleep(30);
	emit({type: 'tool_output', turnId, id: `tool_${turnCounter}`, tool: 'shell', stream: 'stdout', text: 'SMOKE-TOOL-LINE 中文输出行 app.js\ntotal 8\nindex.html'});
	await sleep(30);
	emit({type: 'tool_finished', turnId, id: `tool_${turnCounter}`, tool: 'shell', success: true, fields: {exit: '0', duration: '42ms'}});
	await sleep(30);
	emit({type: 'assistant_delta', turnId, text: '工具执行完毕。\n\n'});
	await sleep(30);
	emit({type: 'assistant_delta', turnId, text: 'SMOKE-FINAL-DONE 全部完成。'});
	await sleep(30);
	// Mirrors the real engine: final_answer repeats the accumulated delta text.
	emit({type: 'final_answer', turnId, text: '收到，开始处理。\n\n第一步：检查目录。\n\n工具执行完毕。\n\nSMOKE-FINAL-DONE 全部完成。'});
	emit({type: 'turn_usage', turnId, turn: turnCounter, tokensUsed: 128 * turnCounter});
	emit({type: 'turn_finished', turnId, success: true});
}

async function runApprovalTurn(command) {
	turnCounter += 1;
	const turnId = `turn_${turnCounter}`;
	const approvalId = `approval_${turnCounter}`;
	emit({type: 'input_accepted', turnId, clientMessageId: command.clientMessageId});
	emit({type: 'turn_started', turnId, clientMessageId: command.clientMessageId, text: command.text});
	emit({type: 'thinking_started', turnId, turn: turnCounter, maxTurns: 50});
	await sleep(30);
	emit({type: 'reasoning_delta', turnId, text: '需要执行一个危险命令，请求用户审批。'});
	await sleep(30);
	emit({
		type: 'approval_requested',
		turnId,
		id: approvalId,
		tool: 'shell',
		description: 'Run rm command',
		risk: 'Shell',
		context: 'rm -rf node_modules'
	});
	pendingApprovals.set(approvalId, {turnId, turnCounter});
}

async function continueAfterApproval(turnId, tc) {
	await sleep(30);
	emit({type: 'tool_started', turnId, id: `tool_${tc}`, tool: 'shell', args: {command: 'rm -rf node_modules'}});
	await sleep(30);
	emit({type: 'tool_output', turnId, id: `tool_${tc}`, tool: 'shell', stream: 'stdout', text: 'APPROVAL-TOOL-DONE'});
	await sleep(30);
	emit({type: 'tool_finished', turnId, id: `tool_${tc}`, tool: 'shell', success: true, fields: {exit: '0', duration: '50ms'}});
	await sleep(30);
	emit({type: 'assistant_delta', turnId, text: 'APPROVAL-FINAL-DONE 审批通过并执行完毕。'});
	emit({type: 'final_answer', turnId, text: 'APPROVAL-FINAL-DONE 审批通过并执行完毕。'});
	emit({type: 'turn_usage', turnId, turn: tc, tokensUsed: 100});
	emit({type: 'turn_finished', turnId, success: true});
}

async function runQuestionTurn(command) {
	turnCounter += 1;
	const turnId = `turn_${turnCounter}`;
	const questionId = `question_${turnCounter}`;
	emit({type: 'input_accepted', turnId, clientMessageId: command.clientMessageId});
	emit({type: 'turn_started', turnId, clientMessageId: command.clientMessageId, text: command.text});
	emit({type: 'thinking_started', turnId, turn: turnCounter, maxTurns: 50});
	await sleep(30);
	emit({
		type: 'question_requested',
		runId: `run_${turnCounter}`,
		turnId,
		id: questionId,
		title: 'Choose option',
		question: 'Which option do you want?',
		options: [
			{id: 'opt1', label: 'Option A', recommended: true},
			{id: 'opt2', label: 'Option B'}
		],
		allowCustom: true,
		allowChat: false
	});
	pendingQuestions.set(questionId, {turnId, turnCounter});
}

async function continueAfterQuestion(turnId, tc) {
	await sleep(30);
	emit({type: 'assistant_delta', turnId, text: 'QUESTION-FINAL-DONE 已根据选择完成。'});
	emit({type: 'final_answer', turnId, text: 'QUESTION-FINAL-DONE 已根据选择完成。'});
	emit({type: 'turn_usage', turnId, turn: tc, tokensUsed: 80});
	emit({type: 'turn_finished', turnId, success: true});
}

async function runClarifyTurn(command) {
	turnCounter += 1;
	const turnId = `turn_${turnCounter}`;
	const clarifyId = `clarify_${turnCounter}`;
	emit({type: 'input_accepted', turnId, clientMessageId: command.clientMessageId});
	emit({type: 'turn_started', turnId, clientMessageId: command.clientMessageId, text: command.text});
	emit({type: 'thinking_started', turnId, turn: turnCounter, maxTurns: 50});
	await sleep(30);
	emit({type: 'reasoning_delta', turnId, text: '需求不明确，需要向用户澄清。'});
	await sleep(30);
	emit({type: 'clarify', runId: `run_${turnCounter}`, turnId, id: clarifyId, question: 'CLARIFY-QUESTION-MARKER 你要哪种格式？'});
	pendingClarifications.set(clarifyId, {turnId, turnCounter});
}

async function continueAfterClarify(turnId, tc, answer) {
	await sleep(30);
	emit({type: 'clarify_resolved', runId: `run_${tc}`, turnId, id: `clarify_${tc}`});
	await sleep(30);
	emit({type: 'assistant_delta', turnId, text: `CLARIFY-FINAL-DONE 收到答复：${answer}`});
	emit({type: 'final_answer', turnId, text: `CLARIFY-FINAL-DONE 收到答复：${answer}`});
	emit({type: 'turn_usage', turnId, turn: tc, tokensUsed: 64});
	emit({type: 'turn_finished', turnId, success: true});
}

async function runFailingTurn(command) {
	turnCounter += 1;
	const turnId = `turn_${turnCounter}`;
	emit({type: 'input_accepted', turnId, clientMessageId: command.clientMessageId});
	emit({type: 'turn_started', turnId, clientMessageId: command.clientMessageId, text: command.text});
	emit({type: 'thinking_started', turnId, turn: turnCounter, maxTurns: 50});
	await sleep(30);
	emit({type: 'tool_started', turnId, id: `tool_${turnCounter}`, tool: 'shell', args: {command: 'cat /nonexistent'}});
	await sleep(30);
	emit({type: 'tool_output', turnId, id: `tool_${turnCounter}`, tool: 'shell', stream: 'stderr', text: 'cat: /nonexistent: No such file or directory'});
	await sleep(30);
	emit({type: 'tool_finished', turnId, id: `tool_${turnCounter}`, tool: 'shell', success: false, fields: {exit: '1'}});
	await sleep(30);
	emit({type: 'run_failed', runId: `run_${turnCounter}`, error: 'RUN-FAILED-MARKER engine gave up'});
}

async function runCommandResultTurn(command) {
	turnCounter += 1;
	const turnId = `turn_${turnCounter}`;
	emit({type: 'input_accepted', turnId, clientMessageId: command.clientMessageId});
	emit({type: 'turn_started', turnId, clientMessageId: command.clientMessageId, text: command.text});
	await sleep(30);
	emit({type: 'command_result', name: 'test-success', message: 'CMD-RESULT-SUCCESS-MARKER\nOperation completed', status: 'success'});
	await sleep(30);
	emit({type: 'command_result', name: 'test-error', message: 'CMD-RESULT-ERROR-MARKER\nSomething went wrong', status: 'error'});
	await sleep(30);
	emit({type: 'command_result', name: 'DecideApproval', message: 'CMD-RESULT-DECIDED-MARKER\nstatus=approved', status: 'decided'});
	await sleep(30);
	emit({type: 'assistant_delta', turnId, text: 'CMD-RESULT-FINAL-DONE'});
	emit({type: 'final_answer', turnId, text: 'CMD-RESULT-FINAL-DONE'});
	emit({type: 'turn_usage', turnId, turn: turnCounter, tokensUsed: 50});
	emit({type: 'turn_finished', turnId, success: true});
}

async function runSelfHealTurn(command) {
	turnCounter += 1;
	const turnId = `turn_${turnCounter}`;
	emit({type: 'input_accepted', turnId, clientMessageId: command.clientMessageId});
	emit({type: 'turn_started', turnId, clientMessageId: command.clientMessageId, text: command.text});
	emit({type: 'thinking_started', turnId, turn: turnCounter, maxTurns: 50});
	await sleep(30);
	emit({type: 'assistant_delta', turnId, text: 'SELF-HEAL-TURN-1-DONE'});
	emit({type: 'final_answer', turnId, text: 'SELF-HEAL-TURN-1-DONE'});
	emit({type: 'turn_usage', turnId, turn: turnCounter, tokensUsed: 50});
	emit({type: 'turn_finished', turnId, success: true});

	await sleep(500);
	emit({
		type: 'session_restored',
		turns: [],
		sessionId: 'mock-session'
	});
}

async function runDelayedApprovalTurn(command) {
	turnCounter += 1;
	const turnId = `turn_${turnCounter}`;
	const approvalId = `delayed_approval_${turnCounter}`;
	emit({type: 'input_accepted', turnId, clientMessageId: command.clientMessageId});
	emit({type: 'turn_started', turnId, clientMessageId: command.clientMessageId, text: command.text});
	emit({type: 'thinking_started', turnId, turn: turnCounter, maxTurns: 50});
	await sleep(30);
	emit({
		type: 'approval_requested',
		turnId,
		id: approvalId,
		tool: 'shell',
		description: 'Run delayed command',
		risk: 'Shell',
		context: 'echo DELAYED-APPROVAL-TEST'
	});
	pendingApprovals.set(approvalId, {turnId, turnCounter, delayed: true});
}

async function runUnresolvedApprovalTurn(command) {
	turnCounter += 1;
	const turnId = `turn_${turnCounter}`;
	emit({type: 'input_accepted', turnId, clientMessageId: command.clientMessageId});
	emit({type: 'turn_started', turnId, clientMessageId: command.clientMessageId, text: command.text});
	emit({type: 'thinking_started', turnId, turn: turnCounter, maxTurns: 50});
	await sleep(30);
	emit({
		type: 'approval_requested',
		turnId,
		id: `unresolved_approval_${turnCounter}`,
		tool: 'shell',
		description: 'Run unresolved command',
		risk: 'Shell',
		context: 'echo UNRESOLVED-APPROVAL-TEST'
	});
	await sleep(300);
	emit({type: 'turn_finished', turnId, success: false});
}

/**
 * Approval black hole: the engine ACKs the decision (command_result decided)
 * but approval_resolved never arrives — the UI must show its optimistic
 * compact state instantly, keep swallowing repeat presses (only ONE
 * DecideApproval may reach the engine) and escalate to a warning after 10s.
 */
async function runBlackholeApprovalTurn(command) {
	turnCounter += 1;
	const turnId = `turn_${turnCounter}`;
	const approvalId = `blackhole_approval_${turnCounter}`;
	emit({type: 'input_accepted', turnId, clientMessageId: command.clientMessageId});
	emit({type: 'turn_started', turnId, clientMessageId: command.clientMessageId, text: command.text});
	emit({type: 'thinking_started', turnId, turn: turnCounter, maxTurns: 50});
	await sleep(30);
	emit({
		type: 'approval_requested',
		turnId,
		id: approvalId,
		tool: 'shell',
		description: 'Run blackhole command',
		risk: 'Shell',
		context: 'echo BLACKHOLE-APPROVAL-TEST'
	});
	pendingApprovals.set(approvalId, {turnId, turnCounter, blackhole: true});
}

let decideCount = 0;

/**
 * Slow streaming shell: output lines trickle in every 500ms while the tool
 * runs (mirrors the engine's new incremental drain), then the authoritative
 * <tool_result…> observation REPLACES the streamed preview before finishing.
 */
async function runSlowStreamTurn(command) {
	turnCounter += 1;
	const turnId = `turn_${turnCounter}`;
	const toolId = `stream_tool_${turnCounter}`;
	emit({type: 'input_accepted', turnId, clientMessageId: command.clientMessageId});
	emit({type: 'turn_started', turnId, clientMessageId: command.clientMessageId, text: command.text});
	emit({type: 'thinking_started', turnId, turn: turnCounter, maxTurns: 50});
	await sleep(30);
	emit({type: 'tool_started', turnId, id: toolId, tool: 'shell', args: {command: 'npm install --verbose'}});
	for (let i = 1; i <= 6; i += 1) {
		await sleep(500);
		emit({type: 'tool_output', turnId, id: toolId, tool: 'shell', stream: 'stdout', text: `STREAM-LINE-${i} fetching package ${i}\n`});
	}
	await sleep(300);
	emit({
		type: 'tool_output', turnId, id: toolId, tool: 'shell', stream: 'stdout',
		text: '<tool_result name="shell" success="true">\noutput: STREAM-FINAL added 6 packages\n</tool_result>'
	});
	emit({type: 'tool_finished', turnId, id: toolId, tool: 'shell', success: true, fields: {exit: '0', duration: '3.3s'}});
	await sleep(30);
	emit({type: 'assistant_delta', turnId, text: 'STREAM-TURN-DONE 安装完成。'});
	emit({type: 'final_answer', turnId, text: 'STREAM-TURN-DONE 安装完成。'});
	emit({type: 'turn_usage', turnId, turn: turnCounter, tokensUsed: 60});
	emit({type: 'turn_finished', turnId, success: true});
}

/**
 * Engine generation change mid-approval: request an approval, then emit a
 * second `ready` with a different engineEpoch (as an engine supervisor restart
 * would). The UI must drop the stale dialog and explain why.
 */
async function runEpochRestartTurn(command) {
	turnCounter += 1;
	const turnId = `turn_${turnCounter}`;
	emit({type: 'input_accepted', turnId, clientMessageId: command.clientMessageId});
	emit({type: 'turn_started', turnId, clientMessageId: command.clientMessageId, text: command.text});
	emit({type: 'thinking_started', turnId, turn: turnCounter, maxTurns: 50});
	await sleep(30);
	emit({
		type: 'approval_requested',
		turnId,
		id: `epoch_approval_${turnCounter}`,
		tool: 'shell',
		description: 'Run command across restart',
		risk: 'Shell',
		context: 'echo EPOCH-APPROVAL-TEST'
	});
	await sleep(1500);
	emit(readyEvent('mock-epoch-2'));
}

function handleCommand(command) {
	emit({
		type: 'command_result',
		name: command.name,
		message: `COMMAND-HELP-RESULT\n/help — Show help\n/model — Show model`,
		status: 'success'
	});
}

const rl = createInterface({input: process.stdin, terminal: false});
rl.on('line', line => {
	const trimmed = line.trim();
	if (!trimmed.startsWith('{')) return;
	let command;
	try {
		command = JSON.parse(trimmed);
	} catch {
		return;
	}
	if (command.type === 'DetachSession') {
		process.exit(0);
	}
	if (command.type === 'Heartbeat') {
		emit({type: 'Heartbeat', sessionId: command.sessionId ?? 'mock-session', clientId: command.clientId, atMillis: Date.now()});
		return;
	}
	if (command.type === 'Ack') {
		return;
	}
	if (command.type === 'AttachSession') {
		if (unixBoot) {
			emit({
				type: 'Attached',
				sessionId: command.sessionId ?? 'mock-sess-boot',
				clientId: command.clientId ?? 'mock-client',
				lastEventSeq: 0
			});
		}
		return;
	}
	if (unixBoot && command.type === 'EnsureProject') {
		emit({
			type: 'command_result',
			name: 'EnsureProject',
			status: 'accepted',
			message: 'created',
			projectId: 'mock-proj-1'
		});
		return;
	}
	if (unixBoot && command.type === 'GetWorkspaceMeta') {
		emit({
			type: 'workspace_meta',
			tenantId: 'default',
			appId: 'default',
			projects: [
				{
					id: 'mock-proj-1',
					projectType: 'coding',
					displayName: 'mock',
					status: 'active',
					isDefault: false
				}
			],
			sessionsByProjectId: {'mock-proj-1': []}
		});
		emit({
			type: 'command_result',
			name: 'GetWorkspaceMeta',
			status: 'accepted',
			message: '1 projects'
		});
		return;
	}
	if (unixBoot && command.type === 'CreateSession') {
		const finish = () => {
			emit({
				type: 'command_result',
				name: 'CreateSession',
				status: 'accepted',
				message: 'ok',
				sessionId: 'mock-sess-boot',
				projectId: command.projectId ?? 'mock-proj-1'
			});
		};
		if (createDelayMs > 0) setTimeout(finish, createDelayMs);
		else finish();
		return;
	}
	if (command.type === 'CancelRun' || command.type === 'CancelSession') {
		emit({type: 'run_cancelled', runId: command.runId ?? `turn_${turnCounter}`, reason: command.reason ?? 'cancelled'});
		// Match Bridge Cancel Settlement: unlock Composer on turn_cancelled.
		emit({type: 'turn_cancelled', reason: command.reason ?? 'cancelled'});
		return;
	}
	if (command.type === 'DecideApproval') {
		decideCount += 1;
		const entry = pendingApprovals.get(command.approvalId ?? command.id);
		if (entry?.blackhole) {
			// ACK the command but never resolve the approval. Surface how many
			// DecideApproval commands actually arrived (UI must debounce to 1).
			emit({type: 'error', message: `DECIDE-RECEIVED-${decideCount}`});
			emit({type: 'command_result', name: 'DecideApproval', message: 'status=Running;decision=applied', status: 'decided'});
			return;
		}
		if (entry) {
			pendingApprovals.delete(command.approvalId ?? command.id);
			const approved = command.approved !== false;
			if (entry.delayed) {
				// Emit command_result(decided) BEFORE approval_resolved to test
				// that the dialog persists through command_result(decided).
				emit({type: 'command_result', name: 'DecideApproval', message: 'DECIDED-BEFORE-RESOLVED\nstatus=Running', status: 'decided'});
				sleep(800).then(() => {
					emit({type: 'approval_resolved', turnId: entry.turnId, id: command.approvalId ?? command.id, approved});
					if (approved) {
						void continueAfterApproval(entry.turnId, entry.turnCounter);
					} else {
						emit({type: 'turn_finished', turnId: entry.turnId, success: false});
					}
				});
			} else {
				emit({type: 'approval_resolved', turnId: entry.turnId, id: command.approvalId ?? command.id, approved});
				emit({type: 'command_result', name: 'DecideApproval', message: `status=${approved ? 'approved' : 'denied'}`, status: 'decided'});
				if (approved) {
					void continueAfterApproval(entry.turnId, entry.turnCounter);
				} else {
					emit({type: 'turn_finished', turnId: entry.turnId, success: false});
				}
			}
		}
		return;
	}
	if (command.type === 'AnswerQuestion') {
		const id = command.questionId ?? command.id;
		const entry = pendingQuestions.get(id);
		if (entry) {
			pendingQuestions.delete(id);
			emit({type: 'question_answered', runId: `run_${entry.turnCounter}`, turnId: entry.turnId, id, selectedOptionId: command.optionId ?? 'opt1'});
			void continueAfterQuestion(entry.turnId, entry.turnCounter);
			return;
		}
		const clarify = pendingClarifications.get(id);
		if (clarify) {
			pendingClarifications.delete(id);
			void continueAfterClarify(
				clarify.turnId,
				clarify.turnCounter,
				command.customText ?? command.answer ?? command.optionId ?? ''
			);
		}
		return;
	}
	if (command.type === 'command') {
		handleCommand(command);
		return;
	}
	if (command.type === 'SubmitUserMessage') {
		if (typeof command.text === 'string' && command.text.includes('深度分析')) {
			void runDeepAnalysisTurn(command);
		} else if (typeof command.text === 'string' && command.text.includes('延迟审批')) {
			void runDelayedApprovalTurn(command);
		} else if (typeof command.text === 'string' && command.text.includes('黑洞审批')) {
			void runBlackholeApprovalTurn(command);
		} else if (typeof command.text === 'string' && command.text.includes('引擎换代')) {
			void runEpochRestartTurn(command);
		} else if (typeof command.text === 'string' && command.text.includes('慢速流式')) {
			void runSlowStreamTurn(command);
		} else if (typeof command.text === 'string' && command.text.includes('未resolved审批')) {
			void runUnresolvedApprovalTurn(command);
		} else if (typeof command.text === 'string' && command.text.includes('需要澄清')) {
			void runClarifyTurn(command);
		} else if (typeof command.text === 'string' && command.text.includes('必然失败')) {
			void runFailingTurn(command);
		} else if (typeof command.text === 'string' && command.text.includes('需要审批')) {
			void runApprovalTurn(command);
		} else if (typeof command.text === 'string' && command.text.includes('选择')) {
			void runQuestionTurn(command);
		} else if (typeof command.text === 'string' && command.text.includes('command结果')) {
			void runCommandResultTurn(command);
		} else if (typeof command.text === 'string' && command.text.includes('自愈测试')) {
			void runSelfHealTurn(command);
		} else {
			void runTurn(command);
		}
	}
});

rl.on('close', () => {
	process.exit(0);
});
