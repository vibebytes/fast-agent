/**
 * Pin fake engines to Bridge Cancel Settlement: Cancel must emit turn_cancelled
 * (not only run_cancelled). Do not reimplement SessionTurn here — just keep the
 * contract so e2eCancel / local UI cannot unlock on the wrong event.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '../../scripts');

function assertCancelEmitsTurnCancelled(source: string, label: string): void {
	const cancelIdx = source.search(/CancelRun/);
	assert.ok(cancelIdx >= 0, `${label}: must handle CancelRun`);
	const window = source.slice(cancelIdx, cancelIdx + 800);
	assert.match(
		window,
		/emit\(\{type:\s*'turn_cancelled'/,
		`${label}: Cancel path must emit({type: 'turn_cancelled', ...}) near CancelRun`
	);
}

test('mock-engine Cancel emits turn_cancelled', () => {
	const source = readFileSync(join(scriptsDir, 'mock-engine.mjs'), 'utf8');
	assertCancelEmitsTurnCancelled(source, 'mock-engine');
});

test('replay-engine Cancel emits turn_cancelled', () => {
	const source = readFileSync(join(scriptsDir, 'replay-engine.mjs'), 'utf8');
	assertCancelEmitsTurnCancelled(source, 'replay-engine');
});
