import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
	commandOwnsThisRuntime,
	commandSharesSlotPorts,
	ensureDaemon,
	engineExtensionsDir,
	isBridgeEngineCommand,
	isLiveBridgeHost,
	peerSocket,
	placedEngineCli,
	resolveDaemonLaunch,
	resourcesEngineCli,
	rocksLockPath,
	runtimeMarkers,
	slotPorts
} from './ensureDaemon.js';

const noRocksHolders = {rocksLockHolders: () => [] as number[]};
const noLiveBridges = {liveBridgePids: () => [] as number[]};
const bridgeCmd =
	'java -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge --transport unix --socket /tmp/b.sock';

test('resolveDaemonLaunch appends loopback --ws only when port given', () => {
	const base = resolveDaemonLaunch('/tmp/b.sock', {FAST_ENGINE_COMMAND: 'fast-cli'});
	assert.ok(!base.args.includes('--ws'));
	const withPort = resolveDaemonLaunch('/tmp/b.sock', {FAST_ENGINE_COMMAND: 'fast-cli'}, 1981);
	assert.deepEqual(withPort.args.slice(-2), ['--ws', '127.0.0.1:1981']);
	assert.equal(withPort.command, base.command);
});

test('resolveDaemonLaunch injects -Dfast.runtime.root from FAST_RUNTIME_ROOT', () => {
	const launch = resolveDaemonLaunch('/tmp/b.sock', {
		FAST_ENGINE_COMMAND: 'fast-cli',
		FAST_RUNTIME_ROOT: '/data/desktop/runtime'
	});
	assert.equal(launch.args[0], '-Dfast.runtime.root=/data/desktop/runtime');
	const noRoot = resolveDaemonLaunch('/tmp/b.sock', {FAST_ENGINE_COMMAND: 'fast-cli'});
	assert.ok(!noRoot.args.some(a => a.startsWith('-Dfast.runtime.root=')));
});

test('resolveDaemonLaunch forces unix transport + socket', () => {
	const launch = resolveDaemonLaunch('/tmp/b.sock', {
		FAST_ENGINE_COMMAND: 'fast-cli',
		FAST_ENGINE_ARGS: 'engine --mode bridge --transport stdio --continue'
	});
	assert.equal(launch.command, 'fast-cli');
	assert.ok(launch.args.includes('--transport'));
	assert.equal(launch.args[launch.args.indexOf('--transport') + 1], 'unix');
	assert.ok(launch.args.includes('--socket'));
	assert.equal(launch.args[launch.args.indexOf('--socket') + 1], '/tmp/b.sock');
	assert.ok(!launch.args.includes('stdio'));
	assert.ok(launch.args.includes('--continue'));
});

test('placedEngineCli finds modules/engine/current walking up', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'fast-placed-'));
	const cli = path.join(root, 'modules', 'engine', 'current', 'bin', 'fast-cli');
	mkdirSync(path.dirname(cli), {recursive: true});
	writeFileSync(cli, '');
	assert.equal(placedEngineCli([path.join(root, 'apps', 'desktop')]), cli);
});

test('resourcesEngineCli reads ELECTRON_RESOURCES_PATH', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'fast-resources-'));
	const cli = path.join(root, 'engine', 'bin', 'fast-cli');
	mkdirSync(path.dirname(cli), {recursive: true});
	writeFileSync(cli, '');
	assert.equal(resourcesEngineCli({ELECTRON_RESOURCES_PATH: root}), cli);
});

test('resolveDaemonLaunch prefers FAST_BUNDLED_ENGINE over placed', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'fast-bundled-daemon-'));
	const placed = path.join(root, 'modules', 'engine', 'current', 'bin', 'fast-cli');
	const bundled = path.join(root, 'pack', 'engine', 'bin', 'fast-cli');
	mkdirSync(path.dirname(placed), {recursive: true});
	mkdirSync(path.dirname(bundled), {recursive: true});
	writeFileSync(placed, '');
	writeFileSync(bundled, '');
	const launch = resolveDaemonLaunch('/tmp/b.sock', {
		FAST_AGENT_ROOT: root,
		FAST_BUNDLED_ENGINE: bundled
	});
	assert.equal(launch.command, bundled);
});

test('resolveDaemonLaunch uses resources engine when command unset', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'fast-res-daemon-'));
	const cli = path.join(root, 'engine', 'bin', 'fast-cli');
	mkdirSync(path.dirname(cli), {recursive: true});
	writeFileSync(cli, '');
	const launch = resolveDaemonLaunch('/tmp/b.sock', {ELECTRON_RESOURCES_PATH: root});
	assert.equal(launch.command, cli);
});

test('resolveDaemonLaunch uses placed engine when command unset', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'fast-placed-daemon-'));
	const cli = path.join(root, 'modules', 'engine', 'current', 'bin', 'fast-cli');
	mkdirSync(path.dirname(cli), {recursive: true});
	writeFileSync(cli, '');
	const launch = resolveDaemonLaunch('/tmp/b.sock', {FAST_AGENT_ROOT: root});
	assert.equal(launch.command, cli);
	assert.ok(launch.args.includes('--socket'));
});

test('ensureDaemon returns existing connection without spawn', async () => {
	const calls: string[] = [];
	const result = await ensureDaemon({
		...noRocksHolders,
		...noLiveBridges,
		env: {HOME: '/tmp/bridge-client-test-home', FAST_RUN_DIR: '/tmp/bridge-client-test-run'},
		startupTimeoutMs: 2_000,
		tryConnect: async () => {
			calls.push('connect');
			return true;
		},
		readToken: () => 'tok-abc',
		exists: () => true,
		ensureDir: () => {},
		spawnDaemon: () => {
			calls.push('spawn');
			return undefined;
		}
	});
	assert.equal(result.token, 'tok-abc');
	assert.equal(result.spawned, false);
	assert.ok(calls.includes('connect'));
	assert.ok(!calls.includes('spawn'));
});

test('ensureDaemon spawns when sock missing then waits for ready', async () => {
	let ready = false;
	let claimed = false;
	const result = await ensureDaemon({
		...noRocksHolders,
		...noLiveBridges,
		env: {HOME: '/tmp/bridge-client-test-home2', FAST_RUN_DIR: '/tmp/bridge-client-test-run2'},
		startupTimeoutMs: 3_000,
		connectTimeoutMs: 500,
		sleep: async () => {},
		now: (() => {
			let t = 0;
			return () => (t += 50);
		})(),
		tryConnect: async () => ready,
		isPidAlive: () => false,
		readPid: () => undefined,
		unlink: () => {
			claimed = false;
		},
		claimPidExclusive: () => {
			if (claimed) throw new Error('EEXIST');
			claimed = true;
		},
		spawnDaemon: () => {
			ready = true;
			return undefined;
		},
		readToken: () => 'spawned-token',
		// pidfile only exists after claim; token after spawn-ready
		exists: p => (p.includes('bridge.pid') ? claimed : p.includes('bridge.token') ? ready : false),
		ensureDir: () => {},
		engineLaunch: sock => ({command: 'mock', args: ['--socket', sock]})
	});
	assert.equal(result.spawned, true);
	assert.equal(result.token, 'spawned-token');
});

test('ensureDaemon waits on non-numeric starting claim then connects', async () => {
	let ready = false;
	let ticks = 0;
	const result = await ensureDaemon({
		...noRocksHolders,
		...noLiveBridges,
		env: {HOME: '/tmp/bridge-client-test-home3', FAST_RUN_DIR: '/tmp/bridge-client-test-run3'},
		startupTimeoutMs: 5_000,
		connectTimeoutMs: 200, // starting claim must ignore CONNECT_TIMEOUT steals
		sleep: async () => {
			ticks += 1;
			if (ticks >= 3) ready = true;
		},
		now: (() => {
			let t = 0;
			return () => (t += 100);
		})(),
		tryConnect: async () => ready,
		isPidAlive: () => false,
		readPid: () => undefined, // "starting"
		unlink: () => {
			assert.fail('must not unlink starting claim while within STARTUP_TIMEOUT');
		},
		claimPidExclusive: () => {
			assert.fail('must not steal starting claim');
		},
		spawnDaemon: () => {
			assert.fail('must not spawn while claim held');
		},
		readToken: () => 'peer-token',
		exists: p => p.includes('bridge.pid') || (ready && p.includes('bridge.token')),
		ensureDir: () => {}
	});
	assert.equal(result.spawned, false);
	assert.equal(result.token, 'peer-token');
});

test('isBridgeEngineCommand matches CliApp and fast-cli bridge hosts', () => {
	assert.equal(isBridgeEngineCommand(bridgeCmd), true);
	assert.equal(
		isBridgeEngineCommand('/opt/fast/engine/bin/fast-cli engine --mode bridge --transport unix'),
		true
	);
	assert.equal(
		isBridgeEngineCommand('/usr/local/bin/fast engine --mode bridge --transport unix'),
		true
	);
	assert.equal(
		isBridgeEngineCommand('/opt/fast/engine/bin/agent-cli engine --mode bridge --transport unix'),
		true
	);
	assert.equal(isBridgeEngineCommand('/usr/sbin/nginx'), false);
	assert.equal(isBridgeEngineCommand('java -cp x ai.fastllm.agent.cli.CliApp engine --mode stdio'), false);
});

test('isLiveBridgeHost treats unknown cmdline as owner; non-bridge as stale', () => {
	assert.equal(isLiveBridgeHost(1, {alive: () => true, commandLine: () => undefined}), true);
	assert.equal(isLiveBridgeHost(1, {alive: () => true, commandLine: () => bridgeCmd}), true);
	assert.equal(isLiveBridgeHost(1, {alive: () => true, commandLine: () => '/usr/sbin/nginx'}), false);
	assert.equal(isLiveBridgeHost(1, {alive: () => false, commandLine: () => bridgeCmd}), false);
});

test('commandSharesSlotPorts uses last enroll/wss and ignores 小B ports', () => {
	const defaults = slotPorts({});
	assert.deepEqual(defaults, {enroll: 2580, wss: 1979, ws: 1981});
	const desktop =
		'java -Dfast.enroll.port=2580 -Dfast.bridge.wss=1979 -Dfast.runtime.root=/Users/kai/Library/Application Support/@fast-ide/desktop/runtime -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge --ws 127.0.0.1:1981';
	assert.equal(commandSharesSlotPorts(desktop, defaults), true);
	const other =
		'java -Dfast.enroll.port=2580 -Dfast.enroll.port=2581 -Dfast.bridge.wss=1982 -Dfast.bridge.ws=1983 -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge --wss 0.0.0.0:1982';
	assert.equal(commandSharesSlotPorts(other, defaults), false);
	assert.equal(
		peerSocket(
			`java --socket /Users/kai/Library/Application Support/@fast-ide/desktop/runtime/run/bridge.sock --continue`
		),
		'/Users/kai/Library/Application Support/@fast-ide/desktop/runtime/run/bridge.sock'
	);
});

test('commandOwnsThisRuntime uses last -Dfast.runtime.root=', () => {
	const desktop = runtimeMarkers({HOME: '/tmp/h', FAST_RUNTIME_ROOT: '/data/desktop/runtime'});
	const other =
		'java -Dfast.runtime.root=$/Users/kai/.fast -Dfast.runtime.root=/Users/kai/.fast-b -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge --wss 0.0.0.0:1982';
	assert.equal(commandOwnsThisRuntime(other, desktop), false);
	assert.equal(
		commandOwnsThisRuntime(other, runtimeMarkers({HOME: '/tmp/h', FAST_RUNTIME_ROOT: '/Users/kai/.fast-b'})),
		true
	);
	assert.equal(
		commandOwnsThisRuntime(
			'java -Dfast.runtime.root=/data/desktop/runtime -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge',
			desktop
		),
		true
	);
	assert.equal(
		commandOwnsThisRuntime(
			'java -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge --socket /data/desktop/runtime/run/bridge.sock',
			desktop
		),
		true
	);
	assert.equal(
		commandOwnsThisRuntime(
			'java -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge --socket /Users/kai/.fast-b/run/bridge.sock',
			desktop
		),
		false
	);
	assert.equal(
		commandOwnsThisRuntime('java -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge', desktop),
		true
	);
});

test('commandOwnsThisRuntime keeps unquoted Application Support paths', () => {
	const root = '/Users/kai/Library/Application Support/@fast-ide/desktop/runtime';
	const markers = runtimeMarkers({HOME: '/tmp/h', FAST_RUNTIME_ROOT: root});
	const desktop =
		'java -Dfast.runtime.root=$/Users/kai/.fast -Dfast.enroll.port=2580 ' +
		`-Dfast.runtime.root=${root} -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge ` +
		`--transport unix --socket ${root}/run/bridge.sock --continue --ws 127.0.0.1:1981`;
	assert.equal(commandOwnsThisRuntime(desktop, markers), true);
	assert.equal(
		commandOwnsThisRuntime(desktop, runtimeMarkers({HOME: '/tmp/h', FAST_RUNTIME_ROOT: '/Users/kai/.fast-b'})),
		false
	);
	assert.equal(
		isLiveBridgeHost(12362, {alive: () => true, commandLine: () => desktop, runtimeRoots: markers}),
		true
	);
});

test('isLiveBridgeHost ignores a Bridge on another FAST_RUNTIME_ROOT', () => {
	const roots = runtimeMarkers({HOME: '/tmp/h', FAST_RUNTIME_ROOT: '/data/desktop/runtime'});
	const other =
		'java -Dfast.runtime.root=/Users/kai/.fast-b -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge';
	assert.equal(
		isLiveBridgeHost(88769, {alive: () => true, commandLine: () => other, runtimeRoots: roots}),
		false
	);
	assert.equal(
		isLiveBridgeHost(1, {
			alive: () => true,
			commandLine: () =>
				'java -Dfast.runtime.root=/data/desktop/runtime -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge',
			runtimeRoots: roots
		}),
		true
	);
});

test('ensureDaemon SIGTERM leftover bundled CLI when wantId set and sock is down', async () => {
	const killed: Array<[number, NodeJS.Signals]> = [];
	let spawned = 0;
	let t = 0;
	const result = await ensureDaemon({
		...noRocksHolders,
		env: {HOME: '/tmp/bridge-reap-home', FAST_RUN_DIR: '/tmp/bridge-reap-run'},
		startupTimeoutMs: 2_000,
		sleep: async () => {},
		now: () => (t += 100),
		tryConnect: async () => spawned > 0,
		isPidAlive: pid => pid === 7777 && killed.length === 0,
		liveBridgePids: () => (killed.length === 0 ? [7777] : []),
		commandLine: () =>
			'/pack/engine/jre/bin/java -cp /pack/engine/lib/* ai.fastllm.agent.cli.CliApp engine --mode bridge --transport unix',
		wantEngineId: '0.3.1 next',
		bundledEngine: '/pack/engine/bin/fast-cli',
		killPid: (pid, signal) => {
			killed.push([pid, signal]);
		},
		readPid: () => undefined,
		unlink: () => {},
		claimPidExclusive: () => {},
		spawnDaemon: () => {
			spawned += 1;
			return undefined;
		},
		readToken: () => 'tok',
		exists: p => spawned > 0 && p.includes('bridge.token'),
		ensureDir: () => {}
	});
	assert.deepEqual(killed, [[7777, 'SIGTERM']]);
	assert.equal(spawned, 1);
	assert.equal(result.spawned, true);
});

test('ensureDaemon attaches to an existing engine that already holds our enroll port', async () => {
	const peerSock =
		'/Users/kai/Library/Application Support/@fast-ide/desktop/runtime/run/bridge.sock';
	const result = await ensureDaemon({
		...noRocksHolders,
		env: {HOME: '/tmp/h', FAST_RUNTIME_ROOT: '/Users/kai/.fast'},
		startupTimeoutMs: 2_000,
		sleep: async () => {},
		now: (() => {
			let t = 0;
			return () => (t += 100);
		})(),
		tryConnect: async p => p === peerSock,
		isPidAlive: () => true,
		liveBridgePids: () => [],
		allBridgePids: () => [12362],
		commandLine: () =>
			`java -Dfast.enroll.port=2580 -Dfast.runtime.root=/Users/kai/Library/Application Support/@fast-ide/desktop/runtime -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge --socket ${peerSock} --ws 127.0.0.1:1981`,
		readPid: () => undefined,
		unlink: () => {},
		claimPidExclusive: () => {
			assert.fail('must attach instead of claiming');
		},
		spawnDaemon: () => {
			assert.fail('must attach instead of spawning');
		},
		readToken: () => 'peer-tok',
		exists: p => String(p).includes('bridge.token'),
		ensureDir: () => {}
	});
	assert.equal(result.socketPath, peerSock);
	assert.equal(result.token, 'peer-tok');
	assert.equal(result.spawned, false);
});

test('ensureDaemon does not attach to a Bridge on different enroll/wss ports', async () => {
	let spawned = 0;
	const result = await ensureDaemon({
		...noRocksHolders,
		env: {HOME: '/tmp/h', FAST_RUNTIME_ROOT: '/Users/kai/.fast'},
		startupTimeoutMs: 2_000,
		sleep: async () => {},
		now: (() => {
			let t = 0;
			return () => (t += 100);
		})(),
		tryConnect: async () => spawned > 0,
		isPidAlive: () => true,
		liveBridgePids: () => [],
		allBridgePids: () => [88769],
		commandLine: () =>
			'java -Dfast.enroll.port=2581 -Dfast.bridge.wss=1982 -Dfast.runtime.root=/Users/kai/.fast-b -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge --wss 0.0.0.0:1982',
		readPid: () => undefined,
		unlink: () => {},
		claimPidExclusive: () => {},
		spawnDaemon: () => {
			spawned += 1;
			return undefined;
		},
		readToken: () => 'tok',
		exists: p => spawned > 0 && String(p).includes('bridge.token'),
		ensureDir: () => {}
	});
	assert.equal(spawned, 1);
	assert.equal(result.spawned, true);
});

test('ensureDaemon spawns when the only live Bridge belongs to another runtime root', async () => {
	let spawned = 0;
	const result = await ensureDaemon({
		...noRocksHolders,
		env: {HOME: '/tmp/h', FAST_RUNTIME_ROOT: '/data/desktop/runtime'},
		startupTimeoutMs: 2_000,
		sleep: async () => {},
		now: (() => {
			let t = 0;
			return () => (t += 100);
		})(),
		tryConnect: async () => spawned > 0,
		isPidAlive: () => true,
		liveBridgePids: () => (spawned > 0 ? [] : [88769]),
		commandLine: () =>
			'java -Dfast.runtime.root=/Users/kai/.fast-b -Dfast.enroll.port=2581 -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge --wss 0.0.0.0:1982',
		readPid: () => undefined,
		unlink: () => {},
		claimPidExclusive: () => {},
		spawnDaemon: () => {
			spawned += 1;
			return undefined;
		},
		readToken: () => 'tok',
		exists: p => spawned > 0 && String(p).includes('bridge.token'),
		ensureDir: () => {}
	});
	assert.equal(spawned, 1);
	assert.equal(result.spawned, true);
});

test('ensureDaemon waits on an unquoted Application Support runtime root', async () => {
	const root = '/Users/kai/Library/Application Support/@fast-ide/desktop/runtime';
	await assert.rejects(
		() =>
			ensureDaemon({
				...noRocksHolders,
				env: {HOME: '/tmp/h', FAST_RUNTIME_ROOT: root},
				startupTimeoutMs: 500,
				connectTimeoutMs: 200,
				sleep: async () => {},
				now: (() => {
					let t = 0;
					return () => (t += 100);
				})(),
				tryConnect: async () => false,
				isPidAlive: () => true,
				liveBridgePids: () => [12362],
				commandLine: () =>
					`java -Dfast.runtime.root=$/Users/kai/.fast -Dfast.runtime.root=${root} -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge --socket ${root}/run/bridge.sock`,
				readPid: () => undefined,
				unlink: () => {},
				claimPidExclusive: () => {
					assert.fail('must not claim over this-root Bridge');
				},
				spawnDaemon: () => {
					assert.fail('must not spawn over this-root Bridge');
				},
				exists: () => false,
				ensureDir: () => {}
			}),
		(err: unknown) => err instanceof Error && err.message.startsWith('ENGINE_BUSY:')
	);
});

test('ensureDaemon still waits when live Bridge declares this FAST_RUNTIME_ROOT', async () => {
	await assert.rejects(
		() =>
			ensureDaemon({
				...noRocksHolders,
				env: {HOME: '/tmp/h', FAST_RUNTIME_ROOT: '/data/desktop/runtime'},
				startupTimeoutMs: 500,
				connectTimeoutMs: 200,
				sleep: async () => {},
				now: (() => {
					let t = 0;
					return () => (t += 100);
				})(),
				tryConnect: async () => false,
				isPidAlive: () => true,
				liveBridgePids: () => [5555],
				commandLine: () =>
					'java -Dfast.runtime.root=/data/desktop/runtime -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge --transport unix',
				readPid: () => undefined,
				unlink: () => {},
				claimPidExclusive: () => {
					assert.fail('must not claim while this-root Bridge exists');
				},
				spawnDaemon: () => {
					assert.fail('must not spawn while this-root Bridge exists');
				},
				exists: () => false,
				ensureDir: () => {}
			}),
		(err: unknown) => err instanceof Error && err.message.startsWith('ENGINE_BUSY:')
	);
});

test('ensureDaemon waits on liveBridgePids — never spawn second JVM', async () => {
	await assert.rejects(
		() =>
			ensureDaemon({
				...noRocksHolders,
				env: {HOME: '/tmp/bridge-client-test-home-live', FAST_RUN_DIR: '/tmp/bridge-client-test-run-live'},
				startupTimeoutMs: 500,
				connectTimeoutMs: 200,
				sleep: async () => {},
				now: (() => {
					let t = 0;
					return () => (t += 100);
				})(),
				tryConnect: async () => false,
				isPidAlive: () => true,
				liveBridgePids: () => [5555],
				readPid: () => undefined,
				unlink: () => {},
				claimPidExclusive: () => {
					assert.fail('must not claim while live Bridge process exists');
				},
				spawnDaemon: () => {
					assert.fail('must not spawn while live Bridge process exists');
				},
				exists: () => false,
				ensureDir: () => {}
			}),
		(err: unknown) => err instanceof Error && err.message.startsWith('ENGINE_BUSY:')
	);
});

test('ensureDaemon ENGINE_BUSY when pid alive but sock never accepts', async () => {
	await assert.rejects(
		() =>
			ensureDaemon({
				...noRocksHolders,
				...noLiveBridges,
				env: {HOME: '/tmp/bridge-client-test-home4', FAST_RUN_DIR: '/tmp/bridge-client-test-run4'},
				// Live pid must be waited for the full cold-boot budget (pid is written before listen).
				startupTimeoutMs: 5_000,
				connectTimeoutMs: 200,
				sleep: async () => {},
				now: (() => {
					let t = 0;
					return () => (t += 100);
				})(),
				tryConnect: async () => false,
				isPidAlive: () => true,
				readPid: () => 4242,
				commandLine: () =>
					'java -cp x ai.fastllm.agent.cli.CliApp engine --mode bridge --transport unix --socket /tmp/bridge-client-test-run4/bridge.sock',
				unlink: () => {},
				claimPidExclusive: () => {
					assert.fail('must not claim over live Bridge pid');
				},
				spawnDaemon: () => undefined,
				exists: () => true,
				ensureDir: () => {}
			}),
		(err: unknown) => err instanceof Error && err.message.startsWith('ENGINE_BUSY:')
	);
});

test('ensureDaemon clears stale pidfile on PID reuse then spawns', async () => {
	let ready = false;
	let claimed = false;
	let unlinkedPid = false;
	const result = await ensureDaemon({
		...noRocksHolders,
		...noLiveBridges,
		env: {HOME: '/tmp/bridge-client-test-home-reuse', FAST_RUN_DIR: '/tmp/bridge-client-test-run-reuse'},
		startupTimeoutMs: 3_000,
		connectTimeoutMs: 500,
		sleep: async () => {},
		now: (() => {
			let t = 0;
			return () => (t += 50);
		})(),
		tryConnect: async () => ready,
		isPidAlive: () => true,
		readPid: () => (claimed ? undefined : 4242),
		commandLine: () => '/usr/sbin/nginx',
		unlink: p => {
			if (String(p).includes('bridge.pid')) unlinkedPid = true;
			claimed = false;
		},
		claimPidExclusive: () => {
			if (claimed) throw new Error('EEXIST');
			claimed = true;
		},
		spawnDaemon: () => {
			ready = true;
			return undefined;
		},
		readToken: () => 'reuse-token',
		exists: p =>
			p.includes('bridge.pid') ? !unlinkedPid || claimed : p.includes('bridge.token') ? ready : false,
		ensureDir: () => {},
		engineLaunch: sock => ({command: 'mock', args: ['--socket', sock]})
	});
	assert.equal(result.spawned, true);
	assert.equal(result.token, 'reuse-token');
	assert.equal(unlinkedPid, true);
});

test('ensureDaemon waits when Rocks LOCK is held by this slot engine (invisible cmdline)', async () => {
	let ticks = 0;
	const result = await ensureDaemon({
		...noLiveBridges,
		env: {HOME: '/tmp/bridge-client-test-home-ownlock', FAST_RUN_DIR: '/tmp/bridge-client-test-run-ownlock'},
		startupTimeoutMs: 3_000,
		connectTimeoutMs: 200,
		sleep: async () => {},
		now: (() => {
			let t = 0;
			return () => (t += 100);
		})(),
		tryConnect: async () => {
			ticks += 1;
			return ticks > 3;
		},
		isPidAlive: pid => pid === 93156,
		readPid: p => (String(p).includes('instance.lock') ? 93156 : undefined),
		unlink: () => {},
		claimPidExclusive: () => {
			assert.fail('must not claim while our own engine boots');
		},
		spawnDaemon: () => {
			assert.fail('must not spawn while our own engine boots');
		},
		rocksLockHolders: () => [93156],
		readToken: () => 'own-token',
		exists: p => (p.includes('bridge.token') ? ticks > 3 : false),
		ensureDir: () => {}
	});
	assert.equal(result.spawned, false);
	assert.equal(result.token, 'own-token');
});

test('ensureDaemon ENGINE_BUSY when Rocks LOCK held — never kill or spawn', async () => {
	await assert.rejects(
		() =>
			ensureDaemon({
				...noLiveBridges,
				env: {HOME: '/tmp/bridge-client-test-home-rocks', FAST_RUN_DIR: '/tmp/bridge-client-test-run-rocks'},
				startupTimeoutMs: 2_000,
				connectTimeoutMs: 200,
				sleep: async () => {},
				now: (() => {
					let t = 0;
					return () => (t += 100);
				})(),
				tryConnect: async () => false,
				isPidAlive: pid => pid === 9099,
				readPid: () => undefined,
				unlink: () => {},
				claimPidExclusive: () => {
					assert.fail('must not claim while Rocks LOCK held');
				},
				spawnDaemon: () => {
					assert.fail('must not spawn while Rocks LOCK held');
				},
				rocksLockHolders: () => [9099],
				exists: () => false,
				ensureDir: () => {}
			}),
		(err: unknown) =>
			err instanceof Error &&
			err.message.startsWith('ENGINE_BUSY:') &&
			err.message.includes('Rocks LOCK')
	);
});

test('ensureDaemon stops spawn storm when Rocks LOCK remains after failed sock wait', async () => {
	let claimed = false;
	let spawns = 0;
	let sockUnlinksAfterSpawn = 0;
	let pidUnlinksAfterSpawn = 0;
	await assert.rejects(
		() =>
			ensureDaemon({
				...noLiveBridges,
				env: {HOME: '/tmp/bridge-client-test-home-storm', FAST_RUN_DIR: '/tmp/bridge-client-test-run-storm'},
				startupTimeoutMs: 5_000,
				connectTimeoutMs: 100,
				sleep: async () => {},
				now: (() => {
					let t = 0;
					return () => (t += 50);
				})(),
				tryConnect: async () => false,
				isPidAlive: pid => pid === 7077,
				readPid: () => undefined,
				unlink: p => {
					if (spawns > 0 && String(p).includes('bridge.sock')) sockUnlinksAfterSpawn += 1;
					if (spawns > 0 && String(p).includes('bridge.pid')) pidUnlinksAfterSpawn += 1;
					claimed = false;
				},
				claimPidExclusive: () => {
					if (claimed) throw new Error('EEXIST');
					claimed = true;
				},
				spawnDaemon: () => {
					spawns += 1;
					return undefined;
				},
				// free before first spawn; held after (JVM opened Rocks, sock never came up)
				rocksLockHolders: () => (spawns > 0 ? [7077] : []),
				exists: p => (p.includes('bridge.pid') ? claimed : false),
				ensureDir: () => {},
				engineLaunch: sock => ({command: 'mock', args: ['--socket', sock]})
			}),
		(err: unknown) => err instanceof Error && err.message.includes('Rocks LOCK')
	);
	assert.equal(spawns, 1);
	// Timeout must not unlink sock or kill — claim pid may be cleared for retry.
	assert.equal(sockUnlinksAfterSpawn, 0);
});

test('ensureDaemon clears dead starting claim when no Bridge JVM appears', async () => {
	let ready = false;
	let claimed = false;
	let spawns = 0;
	let startingUnlinks = 0;
	const result = await ensureDaemon({
		...noRocksHolders,
		...noLiveBridges,
		env: {HOME: '/tmp/bridge-client-test-home-dead-start', FAST_RUN_DIR: '/tmp/bridge-client-test-run-dead-start'},
		startupTimeoutMs: 30_000,
		connectTimeoutMs: 200,
		sleep: async () => {},
		now: (() => {
			let t = 0;
			return () => (t += 1_000);
		})(),
		tryConnect: async () => ready,
		isPidAlive: () => false,
		readPid: () => undefined,
		unlink: p => {
			if (String(p).includes('bridge.pid')) {
				startingUnlinks += 1;
				claimed = false;
			}
		},
		claimPidExclusive: () => {
			if (claimed) throw new Error('EEXIST');
			claimed = true;
		},
		spawnDaemon: () => {
			spawns += 1;
			ready = true;
			return undefined;
		},
		readToken: () => 'recovered-token',
		// First pass: stale "starting" claim with no JVM; after unlink, claim+spawn.
		exists: p =>
			p.includes('bridge.pid')
				? startingUnlinks === 0 || claimed
				: p.includes('bridge.token')
					? ready
					: false,
		ensureDir: () => {},
		engineLaunch: sock => ({command: 'mock', args: ['--socket', sock]})
	});
	assert.equal(startingUnlinks >= 1, true);
	assert.equal(spawns, 1);
	assert.equal(result.token, 'recovered-token');
});

test('rocksLockPath respects FAST_RUNTIME_ROOT', () => {
	assert.equal(
		rocksLockPath({FAST_RUNTIME_ROOT: '/tmp/rt', HOME: '/tmp/h'}),
		'/tmp/rt/rocks/LOCK'
	);
});

test('ensureDaemon backs off when pid claim races then connects', async () => {
	let ready = false;
	let claimAttempts = 0;
	const result = await ensureDaemon({
		...noRocksHolders,
		...noLiveBridges,
		env: {HOME: '/tmp/bridge-client-test-home5', FAST_RUN_DIR: '/tmp/bridge-client-test-run5'},
		startupTimeoutMs: 5_000,
		connectTimeoutMs: 2_000,
		sleep: async () => {
			ready = true;
		},
		now: (() => {
			let t = 0;
			return () => (t += 50);
		})(),
		tryConnect: async () => ready,
		isPidAlive: () => false,
		readPid: () => undefined,
		unlink: () => {},
		claimPidExclusive: () => {
			claimAttempts += 1;
			if (claimAttempts === 1) throw new Error('EEXIST');
		},
		spawnDaemon: () => {
			assert.fail('loser of claim race must not spawn');
		},
		readToken: () => 'race-token',
		exists: p => (p.includes('bridge.pid') ? claimAttempts >= 1 && !ready : p.includes('bridge.token') ? ready : false),
		ensureDir: () => {}
	});
	assert.equal(result.spawned, false);
	assert.equal(result.token, 'race-token');
	assert.ok(claimAttempts >= 1);
});

function extensionFixture(): {root: string; cli: string; extensions: string} {
	const root = mkdtempSync(path.join(tmpdir(), 'fast-ext-'));
	const cli = path.join(root, 'engine', 'bin', 'fast-cli');
	const extensions = path.join(root, 'engine', 'extensions');
	mkdirSync(path.dirname(cli), {recursive: true});
	writeFileSync(cli, '');
	mkdirSync(extensions, {recursive: true});
	return {root, cli, extensions};
}

test('engineExtensionsDir returns sibling extensions of the engine root', () => {
	const fx = extensionFixture();
	assert.equal(engineExtensionsDir({}, fx.cli), fx.extensions);
});

test('engineExtensionsDir skips bare commands without a path separator', () => {
	assert.equal(engineExtensionsDir({}, 'fast-cli'), undefined);
});

test('engineExtensionsDir never overrides explicit FAST_EXTENSIONS', () => {
	const fx = extensionFixture();
	assert.equal(engineExtensionsDir({FAST_EXTENSIONS: '/custom/ext'}, fx.cli), undefined);
});

test('engineExtensionsDir requires the sibling dir to exist', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'fast-ext-'));
	assert.equal(engineExtensionsDir({}, path.join(root, 'engine', 'bin', 'fast-cli')), undefined);
});

test('resolveDaemonLaunch seeds FAST_EXTENSIONS from the bundled engine root', () => {
	const fx = extensionFixture();
	const env: NodeJS.ProcessEnv = {FAST_BUNDLED_ENGINE: fx.cli};
	resolveDaemonLaunch(path.join(fx.root, 'b.sock'), env);
	assert.equal(env.FAST_EXTENSIONS, fx.extensions);
});

test('resolveDaemonLaunch seeds FAST_EXTENSIONS from the placed engine root', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'fast-ext-'));
	const cli = path.join(root, 'modules', 'engine', 'current', 'bin', 'fast-cli');
	const extensions = path.join(root, 'modules', 'engine', 'current', 'extensions');
	mkdirSync(path.dirname(cli), {recursive: true});
	writeFileSync(cli, '');
	mkdirSync(extensions, {recursive: true});
	const env: NodeJS.ProcessEnv = {FAST_AGENT_ROOT: root};
	resolveDaemonLaunch(path.join(root, 'b.sock'), env);
	assert.equal(env.FAST_EXTENSIONS, extensions);
});

test('resolveDaemonLaunch keeps an explicit FAST_EXTENSIONS', () => {
	const fx = extensionFixture();
	const env: NodeJS.ProcessEnv = {FAST_BUNDLED_ENGINE: fx.cli, FAST_EXTENSIONS: '/custom/ext'};
	resolveDaemonLaunch(path.join(fx.root, 'b.sock'), env);
	assert.equal(env.FAST_EXTENSIONS, '/custom/ext');
});
