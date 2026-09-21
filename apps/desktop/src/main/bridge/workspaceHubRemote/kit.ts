/** WorkspaceHub.remote.test fixtures. Loaded by pairing / edge. */
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {WorkspaceHub, type WorkspaceProjectHandlers} from '../WorkspaceHub.js';
import type {BridgeClient} from '../BridgeClient.js';
import {projectHash} from '../projectHash.js';

export type Fake = Pick<BridgeClient, 'start' | 'send' | 'stop'> & {
	commands: BridgeCommand[];
	handlers?: {
		onEvent: (e: BridgeEvent) => void;
		onError: (m: string) => void;
		onExit: (c: number | null, s: NodeJS.Signals | null) => void;
	};
	failStart?: Error;
	clientIds: string[];
};

export function fakeBridge(failStart?: Error): Fake {
	const fake = {
		commands: [] as BridgeCommand[],
		clientIds: [] as string[],
		handlers: undefined as Fake['handlers'],
		failStart,
		start(_cwd: string, handlers: Fake['handlers'], opts?: {clientId?: string; remote?: {url?: string}}) {
			fake.handlers = handlers;
			if (opts?.clientId) fake.clientIds.push(opts.clientId);
			if (failStart) return Promise.reject(failStart);
			queueMicrotask(() => {
				handlers?.onEvent({type: 'HelloOk', hostHome: '/home/kai'});
				handlers?.onEvent({type: 'ready', protocolVersion: 1});
			});
			return Promise.resolve();
		},
		send(cmd: BridgeCommand) {
			fake.commands.push(cmd);
			if (cmd.type === 'RegisterWorkspace') {
				queueMicrotask(() => {
					fake.handlers?.onEvent({
						type: 'command_result',
						name: 'RegisterWorkspace',
						status: 'accepted',
						message: projectHash(cmd.path)
					});
				});
			}
			if (cmd.type === 'ListHostDir') {
				queueMicrotask(() => {
					fake.handlers?.onEvent({
						type: 'command_result',
						name: 'ListHostDir',
						status: 'accepted',
						requestId: cmd.requestId,
						message: 'ok',
						fs: {
							path: cmd.path ?? '/home/kai',
							home: '/home/kai',
							entries: [
								{name: 'code', path: '/home/kai/code', kind: 'dir'},
								{name: '.default_project', path: '/home/kai/.default_project', kind: 'dir'}
							]
						}
					});
				});
			}
			if (cmd.type === 'CreateHostDir') {
				queueMicrotask(() => {
					fake.handlers?.onEvent({
						type: 'command_result',
						name: 'CreateHostDir',
						status: 'accepted',
						requestId: cmd.requestId,
						message: 'created',
						fs: {
							path: `${cmd.parent.replace(/[/\\]+$/, '')}/${cmd.name}`,
							home: '/home/kai',
							name: cmd.name
						}
					});
				});
			}
			return true;
		},
		stop() {}
	};
	return fake as Fake;
}

export function handlers(): WorkspaceProjectHandlers {
	return {onEvent: () => {}, onError: () => {}, onExit: () => {}};
}

export function remoteHub(create: () => Fake, persist?: (id: string) => void) {
	const home = mkdtempSync(path.join(tmpdir(), 'hub-remote-home-'));
	const cwd = mkdtempSync(path.join(tmpdir(), 'hub-remote-cwd-'));
	const hub = new WorkspaceHub({
		createBridge: () => create() as unknown as BridgeClient,
		hostCwd: cwd,
		homeDir: home,
		persistActiveId: persist,
		requestWaitMs: 200,
		registerWaitMs: 200
	});
	hub.bindCommittedEdge('edge-1', {
		url: 'wss://10.0.0.2:1980/bridge',
		authToken: 'tok',
		timeoutMs: 200
	});
	return hub;
}
