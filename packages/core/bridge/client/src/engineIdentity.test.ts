import assert from 'node:assert/strict';
import test from 'node:test';
import {
	commandOwnsCli,
	isPublicWsBind,
	shouldReplaceDaemon,
	shouldStopDaemonOnQuit,
	trimmedId,
	waitWhile
} from './engineIdentity.js';

const bundled = '/Applications/Fast.app/Contents/Resources/engine/bin/fast-cli';
const ourCmd = `${bundled} engine --mode bridge --transport unix`;
const javaCmd =
	'/Applications/Fast.app/Contents/Resources/engine/jre/bin/java --add-opens=java.base/java.nio=ALL-UNNAMED -cp /Applications/Fast.app/Contents/Resources/engine/lib/* ai.fastllm.agent.cli.CliApp engine --mode bridge --transport unix --socket /tmp/b.sock';
const serverCmd = './bin/agent-cli engine --mode bridge --transport unix --ws 0.0.0.0:1979';

test('trimmedId drops blank', () => {
	assert.equal(trimmedId('  0.3.1 jre 2026-09-02T00:00:00.000Z  '), '0.3.1 jre 2026-09-02T00:00:00.000Z');
	assert.equal(trimmedId(''), undefined);
	assert.equal(trimmedId(undefined), undefined);
});

test('isPublicWsBind is only non-loopback --ws/--wss', () => {
	assert.equal(isPublicWsBind(serverCmd), true);
	assert.equal(isPublicWsBind(`${bundled} engine --wss 10.0.0.2:1979`), true);
	assert.equal(isPublicWsBind(`${bundled} engine --ws 127.0.0.1:1979`), false);
	assert.equal(isPublicWsBind(ourCmd), false);
	assert.equal(isPublicWsBind(undefined), false);
});

test('isPublicWsBind reads FAST_BRIDGE_WS when argv has no --ws', () => {
	assert.equal(isPublicWsBind(javaCmd, {FAST_BRIDGE_WS: '0.0.0.0:1979'}), true);
	assert.equal(isPublicWsBind(javaCmd, {FAST_BRIDGE_WSS: '10.0.0.2:1980'}), true);
	assert.equal(isPublicWsBind(javaCmd, {FAST_BRIDGE_WS: '127.0.0.1:1979'}), false);
	assert.equal(isPublicWsBind(`${javaCmd} --ws 127.0.0.1:1979`, {FAST_BRIDGE_WS: '0.0.0.0:1979'}), false);
});

test('shouldReplaceDaemon same id reuses', () => {
	assert.equal(
		shouldReplaceDaemon({wantId: 'v1', haveId: 'v1', commandLine: ourCmd, bundledCli: bundled}),
		false
	);
});

test('shouldReplaceDaemon different id replaces', () => {
	assert.equal(
		shouldReplaceDaemon({wantId: 'v2', haveId: 'v1', commandLine: ourCmd, bundledCli: bundled}),
		true
	);
});

test('shouldReplaceDaemon missing haveId replaces only our bundled leftover', () => {
	assert.equal(
		shouldReplaceDaemon({wantId: 'v2', haveId: undefined, commandLine: ourCmd, bundledCli: bundled}),
		true
	);
	assert.equal(
		shouldReplaceDaemon({wantId: 'v2', haveId: undefined, commandLine: javaCmd, bundledCli: bundled}),
		true
	);
	assert.equal(
		shouldReplaceDaemon({
			wantId: 'v2',
			haveId: undefined,
			commandLine: serverCmd,
			bundledCli: bundled
		}),
		false
	);
	assert.equal(
		shouldReplaceDaemon({wantId: 'v2', haveId: undefined, commandLine: undefined, bundledCli: bundled}),
		false
	);
});

test('shouldReplaceDaemon never touches a public ws host', () => {
	assert.equal(
		shouldReplaceDaemon({wantId: 'v2', haveId: 'v1', commandLine: serverCmd, bundledCli: bundled}),
		false
	);
	assert.equal(
		shouldReplaceDaemon({
			wantId: 'v2',
			haveId: 'v1',
			commandLine: javaCmd,
			bundledCli: bundled,
			env: {FAST_BRIDGE_WS: '0.0.0.0:1979'}
		}),
		false
	);
});

test('shouldReplaceDaemon existence without wantId does not replace', () => {
	assert.equal(shouldReplaceDaemon({haveId: 'v1', commandLine: ourCmd, bundledCli: bundled}), false);
});

test('shouldStopDaemonOnQuit skips remote and public ws', () => {
	assert.equal(shouldStopDaemonOnQuit({remote: true, spawned: true}), false);
	assert.equal(
		shouldStopDaemonOnQuit({remote: false, spawned: true, commandLine: serverCmd, bundledCli: bundled}),
		false
	);
});

test('shouldStopDaemonOnQuit stops spawned or our bundled CLI', () => {
	assert.equal(shouldStopDaemonOnQuit({remote: false, spawned: true, commandLine: ourCmd}), true);
	assert.equal(
		shouldStopDaemonOnQuit({remote: false, spawned: false, commandLine: ourCmd, bundledCli: bundled}),
		true
	);
	assert.equal(
		shouldStopDaemonOnQuit({remote: false, spawned: false, commandLine: javaCmd, bundledCli: bundled}),
		true
	);
	assert.equal(
		shouldStopDaemonOnQuit({remote: false, spawned: false, commandLine: serverCmd, bundledCli: bundled}),
		false
	);
	assert.equal(
		shouldStopDaemonOnQuit({
			remote: false,
			spawned: false,
			commandLine: javaCmd,
			bundledCli: bundled,
			wantId: 'v1',
			haveId: 'v1',
			env: {FAST_BRIDGE_WS: '0.0.0.0:1979'}
		}),
		false
	);
});

test('shouldStopDaemonOnQuit stops when pack stamp matches', () => {
	assert.equal(
		shouldStopDaemonOnQuit({remote: false, spawned: false, wantId: 'v1', haveId: 'v1'}),
		true
	);
	assert.equal(
		shouldStopDaemonOnQuit({remote: false, spawned: false, wantId: 'v2', haveId: 'v1'}),
		false
	);
});

test('commandOwnsCli requires both sides', () => {
	assert.equal(commandOwnsCli(ourCmd, bundled), true);
	assert.equal(commandOwnsCli(javaCmd, bundled), true);
	assert.equal(commandOwnsCli(ourCmd, undefined), false);
	assert.equal(commandOwnsCli(serverCmd, bundled), false);
	assert.equal(commandOwnsCli(javaCmd, './bin/agent-cli'), false);
});

test('waitWhile returns when cond clears', async () => {
	let n = 2;
	const done = await waitWhile(() => --n > 0, {timeoutMs: 1_000, stepMs: 1});
	assert.equal(done, true);
	assert.equal(n, 0);
});
