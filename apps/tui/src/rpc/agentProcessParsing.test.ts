import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeEventSchema, type BridgeEvent} from './protocol.js';
import {parseNdjsonChunk} from './parseNdjson.js';

function simulateAgentProcessParsing(ndjsonLines: string): {events: BridgeEvent[]; errors: string[]} {
	const events: BridgeEvent[] = [];
	const errors: string[] = [];
	let buffer = '';
	buffer = parseNdjsonChunk(buffer, ndjsonLines, line => {
		if (!line.startsWith('{')) return;
		try {
			events.push(bridgeEventSchema.parse(JSON.parse(line)));
		} catch {
			errors.push(`Invalid engine event: ${line}`);
		}
	});
	return {events, errors};
}

// ── DecideApproval command_result (the exact error from production) ──

test('parses DecideApproval command_result with decided status', () => {
	const line = '{"type":"command_result","name":"DecideApproval","message":"status=Running","status":"decided"}\n';
	const {events, errors} = simulateAgentProcessParsing(line);

	assert.equal(errors.length, 0, `unexpected errors: ${errors.join(', ')}`);
	assert.equal(events.length, 1);
	assert.equal(events[0]?.type, 'command_result');
});

test('parses multiple DecideApproval results in sequence', () => {
	const lines = [
		'{"type":"command_result","name":"DecideApproval","message":"status=Running","status":"decided"}',
		'{"type":"command_result","name":"DecideApproval","message":"status=Completed","status":"decided"}',
		'{"type":"command_result","name":"DecideApproval","message":"status=Completed","status":"decided"}'
	].join('\n') + '\n';

	const {events, errors} = simulateAgentProcessParsing(lines);

	assert.equal(errors.length, 0, `unexpected errors: ${errors.join(', ')}`);
	assert.equal(events.length, 3);
	for (const event of events) {
		assert.equal(event.type, 'command_result');
	}
});

// ── All route statuses from SessionEntity ──

test('parses command_result with all SessionEntity route statuses', () => {
	const statuses = ['decided', 'answered', 'accepted', 'rejected', 'cancelled', 'paused', 'resumed', 'triggered'];
	const lines = statuses.map(s =>
		`{"type":"command_result","name":"Test","message":"result","status":"${s}"}`
	).join('\n') + '\n';

	const {events, errors} = simulateAgentProcessParsing(lines);

	assert.equal(errors.length, 0, `unexpected errors: ${errors.join(', ')}`);
	assert.equal(events.length, statuses.length);
});

test('parses SubmitUserMessage command_result with queued status (follow-up while busy)', () => {
	const line =
		'{"type":"command_result","name":"SubmitUserMessage","message":"followUpId=019fb96c-ddcc-73f4-b2f0-5d6ea15e8ccf","status":"queued","sessionId":"019fb8f8-cd2e-7b28-a49e-0cab91e4e3b2"}\n';
	const {events, errors} = simulateAgentProcessParsing(line);
	assert.equal(errors.length, 0, `unexpected errors: ${errors.join(', ')}`);
	assert.equal(events.length, 1);
	assert.equal(events[0]?.type, 'command_result');
	if (events[0]?.type === 'command_result') {
		assert.equal(events[0].status, 'queued');
	}
});

test('parses SubmitUserMessage command_result with steered status (DSH busy insert)', () => {
	const line =
		'{"type":"command_result","name":"SubmitUserMessage","message":"01a00207-efca-731e-be97-c35dd063ba9b:bdc90e91-e72b-4e01-ba66-0cb3d9ccf1e9","status":"steered","sessionId":"01a00207-efca-731e-be97-c35dd063ba9b"}\n';
	const {events, errors} = simulateAgentProcessParsing(line);
	assert.equal(errors.length, 0, `unexpected errors: ${errors.join(', ')}`);
	assert.equal(events.length, 1);
	assert.equal(events[0]?.type, 'command_result');
	if (events[0]?.type === 'command_result') {
		assert.equal(events[0].status, 'steered');
	}
});

// ── Classic command_result statuses still work ──

test('parses command_result with classic statuses', () => {
	const lines = [
		'{"type":"command_result","name":"model","message":"Current model: default","status":"success"}',
		'{"type":"command_result","name":"run","message":"unavailable","status":"unavailable"}',
		'{"type":"command_result","name":"broken","message":"crash","status":"error"}'
	].join('\n') + '\n';

	const {events, errors} = simulateAgentProcessParsing(lines);

	assert.equal(errors.length, 0);
	assert.equal(events.length, 3);
});

// ── Full approval flow simulation (bridge output) ──

test('parses full approval flow: request → resolved → command_result', () => {
	const lines = [
		'{"type":"approval_requested","runId":"run_1","turnId":"turn_1","id":"ap_1","tool":"shell","description":"rm -rf node_modules","risk":"Shell","context":"rm -rf node_modules"}',
		'{"type":"approval_resolved","runId":"run_1","turnId":"turn_1","id":"ap_1","approved":true}',
		'{"type":"command_result","name":"DecideApproval","message":"status=Running","status":"decided"}',
		'{"type":"tool_started","turnId":"turn_1","id":"tool_1","tool":"shell","args":{"command":"rm -rf node_modules"}}',
		'{"type":"tool_output","turnId":"turn_1","id":"tool_1","tool":"shell","stream":"stdout","text":"done"}',
		'{"type":"tool_finished","turnId":"turn_1","id":"tool_1","tool":"shell","success":true,"fields":{"exit_code":"0"}}'
	].join('\n') + '\n';

	const {events, errors} = simulateAgentProcessParsing(lines);

	assert.equal(errors.length, 0, `unexpected errors: ${errors.join(', ')}`);
	assert.equal(events.length, 6);
	assert.deepEqual(events.map(e => e.type), [
		'approval_requested', 'approval_resolved', 'command_result',
		'tool_started', 'tool_output', 'tool_finished'
	]);
});

// ── Non-JSON lines are silently skipped (not errors) ──

test('skips non-JSON lines without error', () => {
	const lines = 'SBT build output: [info] done\n{"type":"ready"}\nmore noise\n';
	const {events, errors} = simulateAgentProcessParsing(lines);

	assert.equal(errors.length, 0);
	assert.equal(events.length, 1);
	assert.equal(events[0]?.type, 'ready');
});

// ── Malformed JSON is reported as error ──

test('reports malformed JSON as invalid engine event', () => {
	const {events, errors} = simulateAgentProcessParsing('{broken json}\n');
	assert.equal(events.length, 0);
	assert.equal(errors.length, 1);
	assert.match(errors[0] ?? '', /Invalid engine event/);
});

// ── Unknown event type is reported as error ──

test('reports unknown event type as invalid engine event', () => {
	const {events, errors} = simulateAgentProcessParsing('{"type":"totally_unknown","data":"x"}\n');
	assert.equal(events.length, 0);
	assert.equal(errors.length, 1);
	assert.match(errors[0] ?? '', /Invalid engine event/);
});

// ── AnswerQuestion command_result with answered status ──

test('parses AnswerQuestion command_result', () => {
	const line = '{"type":"command_result","name":"AnswerQuestion","message":"status=Completed","status":"answered"}\n';
	const {events, errors} = simulateAgentProcessParsing(line);

	assert.equal(errors.length, 0);
	assert.equal(events.length, 1);
	if (events[0]?.type === 'command_result') {
		assert.equal(events[0].status, 'answered');
	}
});

// ── CancelRun/SetMode route results ──

test('parses CancelRun and SetMode route results', () => {
	const lines = [
		'{"type":"command_result","name":"CancelRun","message":"cancelled","status":"cancelled"}',
		'{"type":"command_result","name":"SetMode","message":"mode=plan","status":"accepted"}',
		'{"type":"command_result","name":"SetMode","message":"mode=agent rejected","status":"rejected"}'
	].join('\n') + '\n';

	const {events, errors} = simulateAgentProcessParsing(lines);

	assert.equal(errors.length, 0);
	assert.equal(events.length, 3);
});

// ── Interleaved regular events and route command_results ──

test('handles interleaved events correctly', () => {
	const lines = [
		'{"type":"ready","model":"default","modelDisplay":"default -> deepseek-reasoner"}',
		'{"type":"turn_started","turnId":"turn_1","clientMessageId":"c1","text":"hello"}',
		'{"type":"assistant_delta","turnId":"turn_1","text":"thinking..."}',
		'{"type":"approval_requested","turnId":"turn_1","id":"ap_1","tool":"shell","description":"rm -rf","context":"ctx"}',
		'{"type":"command_result","name":"DecideApproval","message":"status=Running","status":"decided"}',
		'{"type":"approval_resolved","turnId":"turn_1","id":"ap_1","approved":true}',
		'{"type":"assistant_delta","turnId":"turn_1","text":" done."}',
		'{"type":"turn_finished","turnId":"turn_1","success":true}'
	].join('\n') + '\n';

	const {events, errors} = simulateAgentProcessParsing(lines);

	assert.equal(errors.length, 0, `unexpected errors: ${errors.join(', ')}`);
	assert.equal(events.length, 8);
});

// ── command_result without status (optional field) ──

test('parses command_result without status field', () => {
	const line = '{"type":"command_result","name":"help","message":"/help — Show help"}\n';
	const {events, errors} = simulateAgentProcessParsing(line);

	assert.equal(errors.length, 0);
	assert.equal(events.length, 1);
	if (events[0]?.type === 'command_result') {
		assert.equal(events[0].status, undefined);
	}
});

// ── command_result with capability and availability ──

test('parses command_result with capability metadata', () => {
	const line = '{"type":"command_result","name":"run","message":"unavailable","status":"unavailable","capability":"clusterTaskExecution","availability":"capability_unavailable"}\n';
	const {events, errors} = simulateAgentProcessParsing(line);

	assert.equal(errors.length, 0);
	assert.equal(events.length, 1);
	if (events[0]?.type === 'command_result') {
		assert.equal(events[0].capability, 'clusterTaskExecution');
		assert.equal(events[0].availability, 'capability_unavailable');
	}
});

// ── Chunked NDJSON (partial lines across chunks) ──

test('handles chunked NDJSON delivery', () => {
	const events: BridgeEvent[] = [];
	const errors: string[] = [];

	let buffer = '';
	buffer = parseNdjsonChunk(buffer, '{"type":"command_re', line => {
		if (!line.startsWith('{')) return;
		try { events.push(bridgeEventSchema.parse(JSON.parse(line))); }
		catch { errors.push(`Invalid: ${line}`); }
	});

	assert.equal(events.length, 0);
	assert.equal(errors.length, 0);

	buffer = parseNdjsonChunk(buffer, 'sult","name":"DecideApproval","message":"ok","status":"decided"}\n', line => {
		if (!line.startsWith('{')) return;
		try { events.push(bridgeEventSchema.parse(JSON.parse(line))); }
		catch { errors.push(`Invalid: ${line}`); }
	});

	assert.equal(events.length, 1);
	assert.equal(errors.length, 0);
	assert.equal(events[0]?.type, 'command_result');
});
