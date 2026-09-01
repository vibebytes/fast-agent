import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';

const fixturePath = process.argv[2];
if (!fixturePath) {
	console.error('Usage: replay-engine.mjs <fixture.jsonl>');
	process.exit(1);
}

const fixture = readFileSync(fixturePath, 'utf8')
	.split(/\r?\n/)
	.map(line => line.trim())
	.filter(Boolean)
	.map(line => eventFromLine(JSON.parse(line)))
	.filter(Boolean);

let eventSeq = 0;
let index = process.env.FAST_REPLAY_START_AT_SESSION_RESTORED === '1'
	? Math.max(0, fixture.findIndex(event => event.type === 'session_restored'))
	: 0;
let cancelled = false;
let currentRunId = 'replay-run';
const replayDelayMs = Number(process.env.FAST_REPLAY_EVENT_DELAY_MS ?? '0');

function eventFromLine(line) {
	if (line?.direction && line.direction !== 'event') return undefined;
	const event = line?.direction === 'event' ? line.payload : line;
	if (!event || typeof event !== 'object') return undefined;
	if (['ready', 'commands_available', 'engine_status', 'Attached', 'Ack', 'Heartbeat'].includes(event.type)) return undefined;
	return event;
}

function emit(event) {
	const hydrated = hydrate(event);
	delete hydrated.eventSeq;
	process.stdout.write(`${JSON.stringify({...hydrated, eventSeq: ++eventSeq})}\n`);
}

function hydrate(value) {
	if (typeof value === 'string') {
		return value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, name) => process.env[name] ?? '');
	}
	if (Array.isArray(value)) return value.map(hydrate);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, hydrate(entry)]));
	}
	return value;
}

async function emitUntilBoundary() {
	cancelled = false;
	while (index < fixture.length) {
		if (cancelled) {
			skipCurrentTurn();
			break;
		}
		const event = fixture[index++];
		if (typeof event.turnId === 'string') currentRunId = event.turnId;
		if (typeof event.runId === 'string') currentRunId = event.runId;
		emit(event);
		if (event.type === 'approval_requested' || event.type === 'question_requested' || event.type === 'turn_finished') {
			break;
		}
		if (replayDelayMs > 0) await delay(replayDelayMs);
	}
}

function skipCurrentTurn() {
	while (index < fixture.length && fixture[index]?.type !== 'turn_finished') {
		index++;
	}
	if (fixture[index]?.type === 'turn_finished') index++;
}

function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

emit({
	type: 'ready',
	protocolVersion: 2,
	capabilities: ['structuredQuestions'],
	model: 'replay-model',
	modelDisplay: 'Replay Model',
	maxTurns: 50,
	standalone: true,
	cwd: process.cwd(),
	mode: 'bridge',
	sessionId: 'replay-session'
});
emit({
	type: 'commands_available',
	commands: [
		{name: 'help', description: 'Show help', usage: '/help', available: true}
	]
});
emitStartupEvents();

function emitStartupEvents() {
	while (fixture[index]?.type === 'session_restored') {
		emit(fixture[index++]);
	}
	const nextTurnText = process.env.FAST_REPLAY_NEXT_TURN_TEXT;
	if (nextTurnText) {
		const nextTurnIndex = fixture.findIndex((event, candidate) =>
			candidate >= index
			&& event.type === 'turn_started'
			&& typeof event.text === 'string'
			&& event.text.includes(nextTurnText)
		);
		if (nextTurnIndex >= 0) {
			index = fixture[nextTurnIndex - 1]?.type === 'input_accepted'
				? nextTurnIndex - 1
				: nextTurnIndex;
		}
	}
}

const rl = createInterface({input: process.stdin});
rl.on('line', line => {
	if (!line.trim()) return;
	const command = JSON.parse(line);
	switch (command.type) {
		case 'SubmitUserMessage':
			void emitUntilBoundary();
			break;
		case 'DecideApproval':
		case 'AnswerQuestion':
			void emitUntilBoundary();
			break;
		case 'CancelRun':
		case 'CancelSession':
			cancelled = true;
			emit({type: 'command_result', name: command.type, message: 'cancelled', status: 'cancelled'});
			emit({type: 'run_cancelled', runId: command.runId ?? currentRunId, reason: command.reason ?? 'cancelled'});
			// Match Bridge Cancel Settlement: unlock Composer on turn_cancelled,
			// not run_cancelled (cli-ink keeps running=true until settlement).
			emit({type: 'turn_cancelled', reason: command.reason ?? 'cancelled'});
			break;
		case 'AttachSession':
			break;
		case 'DetachSession':
			process.exit(0);
			break;
		case 'Ack':
			break;
		case 'Heartbeat':
			emit({type: 'Heartbeat', sessionId: command.sessionId ?? 'replay-session', clientId: command.clientId, atMillis: Date.now()});
			break;
		default:
			emit({type: 'command_result', name: command.name ?? command.type, message: 'Replay command ignored', status: 'success'});
	}
});
