import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {BridgeCommand} from '@fastllm/bridge-protocol';
import {BridgeClient} from './BridgeClient.js';
import {WorkspaceHub} from './WorkspaceHub.js';
import {projectHash} from './projectHash.js';

type GitReply =
	| {
			mode: 'ready';
			branch?: string;
			files?: Array<{path: string; kind: 'modified' | 'added' | 'deleted'}>;
	  }
	| {mode: 'not-git'}
	| {mode: 'error'; message?: string};

async function hubWithGit(
	reply: GitReply | ((cmd: Extract<BridgeCommand, {type: 'GitWorkspaceStatus'}>) => GitReply)
): Promise<{hub: WorkspaceHub; commands: BridgeCommand[]; root: string}> {
	const commands: BridgeCommand[] = [];
	const stdout = new PassThrough();
	const stdin = new PassThrough();
	const stderr = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		stdout,
		stderr,
		stdin,
		killed: false,
		pid: 1,
		kill(this: EventEmitter & {killed: boolean}) {
			this.killed = true;
			this.emit('exit', 0, null);
		}
	});

	const client = new BridgeClient({spawnImpl: () => child as never});
	const origStart = client.start.bind(client);
	client.start = ((workspaceRoot, handlers, launchOptions = {}) => {
		origStart(workspaceRoot, handlers, {
			...launchOptions,
			env: {
				FAST_ENGINE_COMMAND: 'mock',
				FAST_ENGINE_ARGS: 'engine --mode bridge --transport stdio --new',
				...(launchOptions.env ?? {})
			},
			bundledEnginePath: '/unused',
			sessionMode: 'new'
		});
		queueMicrotask(() => {
			stdout.write(
				`${JSON.stringify({
					type: 'ready',
					protocolVersion: 2,
					sessionId: 'host-sess',
					cwd: workspaceRoot,
					mode: 'bridge'
				})}\n`
			);
		});
	}) as BridgeClient['start'];

	const origSend = client.send.bind(client);
	client.send = ((cmd: BridgeCommand) => {
		commands.push(cmd);
		const ok = origSend(cmd);
		if (cmd.type === 'RegisterWorkspace') {
			queueMicrotask(() => {
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'RegisterWorkspace',
						message: projectHash(cmd.path),
						status: 'accepted'
					})}\n`
				);
			});
		}
		if (cmd.type === 'GitWorkspaceStatus') {
			const r = typeof reply === 'function' ? reply(cmd) : reply;
			queueMicrotask(() => {
				if (r.mode === 'error') {
					stdout.write(
						`${JSON.stringify({
							type: 'command_result',
							name: 'GitWorkspaceStatus',
							message: r.message ?? 'git status failed',
							status: 'error',
							requestId: cmd.requestId,
							pathHash: cmd.workspaceId
						})}\n`
					);
					return;
				}
				if (r.mode === 'not-git') {
					stdout.write(
						`${JSON.stringify({
							type: 'command_result',
							name: 'GitWorkspaceStatus',
							message: 'not a git work tree',
							status: 'success',
							requestId: cmd.requestId,
							pathHash: cmd.workspaceId,
							git: {available: false}
						})}\n`
					);
					return;
				}
				const files = r.files ?? [{path: 'a.txt', kind: 'modified' as const}];
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'GitWorkspaceStatus',
						message: `branch=${r.branch ?? 'main'} files=${files.length}`,
						status: 'success',
						requestId: cmd.requestId,
						pathHash: cmd.workspaceId,
						git: {
							available: true,
							branch: r.branch ?? 'main',
							dirty: files.length > 0,
							files
						}
					})}\n`
				);
			});
		}
		if (cmd.type === 'ListProviders') {
			queueMicrotask(() => {
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'ListProviders',
						message: '0 providers',
						status: 'accepted',
						providers: []
					})}\n`
				);
			});
		}
		if (cmd.type === 'CreateProject') {
			queueMicrotask(() => {
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'CreateProject',
						message: 'ok',
						status: 'accepted',
						projectId: 'proj-1',
						workspaceId: 'meta-ws-1',
						pathHash: projectHash((cmd as {rootPath?: string}).rootPath ?? '')
					})}\n`
				);
			});
		}
		return ok;
	}) as BridgeClient['send'];

	const root = mkdtempSync(path.join(tmpdir(), 'hub-git-'));
	const hub = new WorkspaceHub({
		createBridge: () => client,
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	hub.openProject(root, {
		onEvent: () => {},
		onError: () => {},
		onExit: () => {}
	});
	await new Promise(r => setTimeout(r, 100));
	assert.ok(hub.getActive()?.workspaceId, 'workspaceId after Register');
	return {hub, commands, root};
}

test('gitWorkspaceStatus maps Bridge git payload and respects fresh TTL', async () => {
	const {hub, commands} = await hubWithGit({mode: 'ready'});

	const first = await hub.gitWorkspaceStatus();
	assert.ok(first, `expected status, commands=${JSON.stringify(commands.map(c => c.type))}`);
	assert.equal(first.branch, 'main');
	assert.equal(first.files[0]?.path, 'a.txt');
	const sent = commands.filter(c => c.type === 'GitWorkspaceStatus').length;
	assert.ok(sent >= 1);

	const cached = await hub.gitWorkspaceStatus();
	assert.equal(cached?.branch, 'main');
	assert.equal(commands.filter(c => c.type === 'GitWorkspaceStatus').length, sent);

	const forced = await hub.gitWorkspaceStatus(true);
	assert.equal(forced?.branch, 'main');
	assert.ok(commands.filter(c => c.type === 'GitWorkspaceStatus').length > sent);

	hub.closeAll();
});

test('available:false arms not-git TTL; soft error keeps last good', async () => {
	const {hub, commands} = await hubWithGit({mode: 'not-git'});

	assert.equal(await hub.gitWorkspaceStatus(), null);
	const afterNotGit = commands.filter(c => c.type === 'GitWorkspaceStatus').length;
	assert.ok(afterNotGit >= 1);
	assert.equal(await hub.gitWorkspaceStatus(), null);
	assert.equal(
		commands.filter(c => c.type === 'GitWorkspaceStatus').length,
		afterNotGit,
		'not-git TTL should suppress re-probe'
	);
	hub.closeAll();

	let mode: GitReply = {mode: 'ready'};
	const soft = await hubWithGit(() => mode);
	const first = await soft.hub.gitWorkspaceStatus();
	assert.equal(first?.branch, 'main');
	const n1 = soft.commands.filter(c => c.type === 'GitWorkspaceStatus').length;
	mode = {mode: 'error', message: 'git status failed'};
	const kept = await soft.hub.gitWorkspaceStatus(true);
	assert.equal(kept?.branch, 'main', 'soft error must keep last good snapshot');
	assert.ok(soft.commands.filter(c => c.type === 'GitWorkspaceStatus').length > n1);
	const n2 = soft.commands.filter(c => c.type === 'GitWorkspaceStatus').length;
	assert.equal(await soft.hub.gitWorkspaceStatus(), kept);
	assert.equal(
		soft.commands.filter(c => c.type === 'GitWorkspaceStatus').length,
		n2,
		'soft keep uses fresh TTL, not a blank wipe'
	);
	soft.hub.closeAll();
});
