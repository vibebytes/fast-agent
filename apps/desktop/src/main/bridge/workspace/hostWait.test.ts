import assert from 'node:assert/strict';
import test from 'node:test';
import {createHostWait} from './hostWait.js';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

test('host_error fails pending host command waits with the engine message', async () => {
	const hostWait = createHostWait({requestWaitMs: 100});
	const pending = hostWait.wait(['McpConfigImport'], undefined, 5_000);
	const failure = assert.rejects(pending.promise, /missing field `payload`/);
	hostWait.hostError("Invalid command: missing field `payload`");
	await failure;
});

test('host_error clears the timeout clock', async () => {
	const hostWait = createHostWait({requestWaitMs: 100});
	const pending = hostWait.wait(['McpServerDelete'], undefined, 20);
	const failure = assert.rejects(pending.promise, /missing field `name`/);
	hostWait.hostError('Invalid command: missing field `name`');
	await failure;
	await sleep(40);
});

test('host_error leaves request waits untouched', async () => {
	const hostWait = createHostWait({requestWaitMs: 5_000});
	const pending = hostWait.waitRequest('req-1');
	hostWait.hostError('Command failed: unrelated');
	const verdict = await Promise.race([
		pending.promise.then(
			() => 'resolved' as const,
			() => 'rejected' as const
		),
		sleep(20).then(() => 'pending' as const)
	]);
	assert.equal(verdict, 'pending');
	hostWait.cancelAll();
});
