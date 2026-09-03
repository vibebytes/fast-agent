import test from 'node:test';
import assert from 'node:assert/strict';
import {
	peelEventType,
	reportInvalidEngineLine,
	terminalParseFailure,
	TERMINAL_PARSE_FAILURE_PREFIX,
	PROTOCOL_MISMATCH_PREFIX,
	CONSECUTIVE_PARSE_FAIL_NOTICE
} from './eventPeel.js';

test('peelEventType reads a type field without re-parsing', () => {
	assert.equal(peelEventType('{"type":"turn_finished","success":true}'), 'turn_finished');
	assert.equal(peelEventType('{ "type" : "run_done" }'), 'run_done');
	assert.equal(peelEventType('not-json'), '');
});

test('terminalParseFailure upgrades settle types only', () => {
	assert.equal(
		terminalParseFailure('{"type":"turn_finished","success":"nope"}'),
		`${TERMINAL_PARSE_FAILURE_PREFIX} turn_finished`
	);
	assert.equal(terminalParseFailure('{"type":"assistant_delta","text":42}'), undefined);
	assert.equal(terminalParseFailure('{broken'), undefined);
});

test('reportInvalidEngineLine routes terminal parse failures to onTerminal', () => {
	const terminals: string[] = [];
	const logs: string[] = [];
	reportInvalidEngineLine('{"type":"run_cancelled"}', {
		onTerminal: m => terminals.push(m),
		onLog: m => logs.push(m)
	});
	assert.deepEqual(terminals, [`${TERMINAL_PARSE_FAILURE_PREFIX} run_cancelled`]);
	assert.deepEqual(logs, []);

	reportInvalidEngineLine('{"type":"assistant_delta","text":1}', {
		onTerminal: m => terminals.push(m),
		onLog: m => logs.push(m)
	});
	assert.equal(terminals.length, 1);
	assert.match(logs[0]!, /^Invalid engine event:/);
});

test('protocol mismatch prefix is distinct from terminal parse failure', () => {
	assert.equal(CONSECUTIVE_PARSE_FAIL_NOTICE, 3);
	assert.match(`${PROTOCOL_MISMATCH_PREFIX} 3 consecutive parse failures`, /^protocol mismatch:/);
	assert.equal(
		`${PROTOCOL_MISMATCH_PREFIX} 3 consecutive parse failures`.startsWith(TERMINAL_PARSE_FAILURE_PREFIX),
		false
	);
});
