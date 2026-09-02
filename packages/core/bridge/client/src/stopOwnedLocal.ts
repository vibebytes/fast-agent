import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {shouldStopDaemonOnQuit, waitWhile} from './engineIdentity.js';
import {engineCommandLine, isPidAlive} from './ensureDaemon.js';
import {bridgePaths} from './paths.js';
import {connectUnix, tryConnectUnix, type UnixConnection} from './unixConnection.js';

const CONNECT_MS = 3_000;
const HELLO_MS = 3_000;
const STOP_WAIT_MS = 10_000;

export type StopOwnedLocalOpts = {
	env?: NodeJS.ProcessEnv;
	tryConnect?: (socketPath: string) => Promise<boolean>;
	connectUnix?: typeof connectUnix;
	readToken?: (tokenFile: string) => string;
	commandLine?: (pid: number) => string | undefined;
	isPidAlive?: (pid: number) => boolean;
	clientKind?: string;
};

function tokenOf(tokenFile: string): string {
	try {
		return readFileSync(tokenFile, 'utf8').trim();
	} catch {
		return '';
	}
}

function waitHello(onHello: (fn: (event: BridgeEvent) => void) => void): Promise<BridgeEvent> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error('Hello timed out waiting for HelloOk'));
		}, HELLO_MS);
		const onEvent = (event: BridgeEvent) => {
			if (event.type !== 'HelloOk' && event.type !== 'HelloReject') return;
			cleanup();
			resolve(event);
		};
		const cleanup = () => {
			clearTimeout(timer);
			onHello(() => {});
		};
		onHello(onEvent);
	});
}

/**
 * Shutdown a leftover local host we own. Never spawns. Public `--ws` and
 * hand-started CLIs that are not our pack are left running.
 */
export async function stopOwnedLocal(opts: StopOwnedLocalOpts = {}): Promise<void> {
	const env = opts.env ?? process.env;
	const paths = bridgePaths(env);
	const tryConnect = opts.tryConnect ?? (p => tryConnectUnix(p));
	if (!(await tryConnect(paths.socketPath))) return;

	const connect = opts.connectUnix ?? connectUnix;
	let onEvent: (event: BridgeEvent) => void = () => {};
	let conn: UnixConnection;
	try {
		conn = await connect(
			paths.socketPath,
			{
				onEvent: event => onEvent(event),
				onError: () => {},
				onClose: () => {}
			},
			{timeoutMs: CONNECT_MS}
		);
	} catch {
		return;
	}
	const helloP = waitHello(fn => {
		onEvent = fn;
	});
	const clientId = `fast-ide-quit-${randomUUID()}`;
	const hello: BridgeCommand = {
		type: 'Hello',
		protocolVersion: 1,
		clientId,
		clientKind: opts.clientKind ?? 'fast-ide',
		pid: process.pid,
		authToken: (opts.readToken ?? tokenOf)(paths.tokenFile) || undefined
	};
	if (!conn.send(hello)) {
		conn.close();
		return;
	}
	const reply = await helloP.catch(() => undefined);
	if (!reply || reply.type !== 'HelloOk') {
		conn.close();
		return;
	}
	const lineOf = opts.commandLine ?? engineCommandLine;
	const cmd = reply.daemonPid != null ? lineOf(reply.daemonPid) : undefined;
	if (
		!shouldStopDaemonOnQuit({
			remote: false,
			spawned: false,
			commandLine: cmd,
			bundledCli: env.FAST_BUNDLED_ENGINE,
			wantId: env.FAST_WANT_ENGINE_ID,
			haveId: reply.engineId,
			env
		})
	) {
		conn.send({type: 'Goodbye', clientId, reason: 'client_exit'});
		conn.close();
		return;
	}
	conn.send({type: 'Shutdown', force: false});
	const alive = opts.isPidAlive ?? isPidAlive;
	if (reply.daemonPid != null) {
		await waitWhile(() => alive(reply.daemonPid!), {timeoutMs: STOP_WAIT_MS});
	}
	conn.close();
}
