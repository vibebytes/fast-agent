/** WorkspaceHub.remote.test — pairing / host FS / adopt. Loaded by WorkspaceHub.remote.test.ts. */
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {BridgeCommand} from '@fastllm/bridge-protocol';
import {WorkspaceHub} from '../WorkspaceHub.js';
import type {BridgeClient} from '../BridgeClient.js';
import {projectHash} from '../projectHash.js';
import {discoverHostSlashSkills} from '../hostSkillDiscovery.js';
import {fakeBridge, handlers, remoteHub} from './kit.js';

test('remote applyWorkspaceMeta adopts a path that does not exist locally', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	fake.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'srv-1',
				projectType: 'coding',
				displayName: 'foo',
				status: 'active',
				isDefault: false,
				workspace: {id: 'ws-1', placement: 'local', rootPath: '/home/kai/foo', pathHash: 'abc'}
			}
		],
		sessionsByProjectId: {}
	});
	const listed = hub.listProjects();
	assert.equal(listed.length, 1);
	assert.equal(listed[0]?.path, '/home/kai/foo');
	assert.equal(
		fake.commands.some(c => c.type === 'CreateProject'),
		false
	);
	hub.closeAll();
});

test('remote openProject is refused and sends no CreateProject', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 10));
	assert.throws(() => hub.openProject('/tmp/local-only', handlers()), /remote edge/);
	assert.equal(
		fake.commands.some(c => c.type === 'CreateProject'),
		false
	);
	hub.closeAll();
});

test('remote ensureDefaultProject throws when host home is unknown and does not mkdir a local row', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	assert.throws(() => hub.ensureDefaultProject(handlers()), /host home is unknown/);
	assert.equal(hub.listAllProjects().length, 0);
	hub.closeAll();
});

test('remote ensureDefaultProject adopts $HOME/fast_workspace/.default_project after HelloOk', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const snap = hub.ensureDefaultProject(handlers());
	assert.equal(snap.path, '/home/kai/fast_workspace/.default_project');
	assert.equal(hub.getDefaultProject()?.isDefault, true);
	assert.equal(hub.getDefaultProject()?.sessions.tasksHydrated, true);
	assert.equal(hub.listProjects().length, 0);
	assert.equal(hub.listAllProjects().length, 1);
	hub.closeAll();
});

test('remote isDefault meta does not call local ensureDefaultProject', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	const localDefaultBefore = hub.getDefaultProject();
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	fake.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'remote-default',
				projectType: 'general',
				displayName: 'Default Project',
				status: 'active',
				isDefault: true,
				workspace: {
					id: 'ws-def',
					placement: 'local',
					rootPath: '/home/kai/fast_workspace/.default_project',
					pathHash: 'def'
				}
			}
		],
		sessionsByProjectId: {}
	});
	assert.equal(hub.listProjects().length, 0);
	assert.ok(hub.getDefaultProject());
	assert.equal(hub.getDefaultProject()?.path, '/home/kai/fast_workspace/.default_project');
	assert.equal(localDefaultBefore, null);
	hub.closeAll();
});

test('trailing-slash remote path dedups with workspace_meta', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const snap = await hub.openRemoteProject('/home/kai/foo/', handlers());
	fake.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'srv-foo',
				projectType: 'coding',
				displayName: 'foo',
				status: 'active',
				isDefault: false,
				workspace: {
					id: 'ws-foo',
					placement: 'local',
					rootPath: '/home/kai/foo',
					pathHash: projectHash('/home/kai/foo')
				}
			}
		],
		sessionsByProjectId: {}
	});
	assert.equal(hub.listProjects().length, 1);
	assert.equal(hub.listProjects()[0]?.id, snap.id);
	hub.closeAll();
});

test('remote workspace_meta stale probe with pathHash skips RegisterWorkspace', async () => {
	const stale = '/var/folders/3s/yfml71wx6rb9qx_b59fdxbkm0000gn/T/queue-echo-probe-SNj4wy';
	const engineErrors: string[] = [];
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine({
		...handlers(),
		onError: (id, message) => {
			if (id === 'engine') engineErrors.push(message);
		}
	});
	await new Promise(r => setTimeout(r, 20));
	fake.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'probe',
				projectType: 'coding',
				displayName: 'queue-echo-probe-SNj4wy',
				status: 'active',
				isDefault: false,
				workspace: {id: 'ws-probe', placement: 'local', rootPath: stale, pathHash: 'deadbeef'}
			}
		],
		sessionsByProjectId: {}
	});
	await new Promise(r => setTimeout(r, 20));
	assert.deepEqual(engineErrors, []);
	assert.equal(fake.commands.filter(c => c.type === 'RegisterWorkspace').length, 0);
	assert.equal(hub.listProjects().length, 1);
	assert.equal(hub.listProjects()[0]?.path, stale);
	hub.closeAll();
});

test('remote RegisterWorkspace not-a-directory stays on that project', async () => {
	const stale = '/var/folders/3s/yfml71wx6rb9qx_b59fdxbkm0000gn/T/queue-echo-probe-Gone';
	const engineErrors: string[] = [];
	const fake = fakeBridge();
	const origSend = fake.send.bind(fake);
	fake.send = (cmd: BridgeCommand) => {
		if (cmd.type === 'RegisterWorkspace') {
			fake.commands.push(cmd);
			queueMicrotask(() => {
				fake.handlers?.onEvent({
					type: 'command_result',
					name: 'RegisterWorkspace',
					status: 'error',
					message: `not a directory: ${stale}`
				});
			});
			return true;
		}
		return origSend(cmd);
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine({
		...handlers(),
		onError: (id, message) => {
			if (id === 'engine') engineErrors.push(message);
		}
	});
	await new Promise(r => setTimeout(r, 20));
	fake.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'probe',
				projectType: 'coding',
				displayName: 'gone',
				status: 'active',
				isDefault: false,
				workspace: {id: 'ws-gone', placement: 'local', rootPath: stale}
			}
		],
		sessionsByProjectId: {}
	});
	await new Promise(r => setTimeout(r, 20));
	assert.deepEqual(engineErrors, []);
	assert.equal(hub.listProjects().length, 1);
	assert.match(hub.listProjects()[0]?.error ?? '', /not a directory/);
	hub.closeAll();
});

test('openRemoteProject missing dir deletes the row and sends no CreateProject', async () => {
	const fake = fakeBridge();
	const origSend = fake.send.bind(fake);
	fake.send = (cmd: BridgeCommand) => {
		if (cmd.type === 'RegisterWorkspace') {
			fake.commands.push(cmd);
			queueMicrotask(() => {
				fake.handlers?.onEvent({
					type: 'command_result',
					name: 'RegisterWorkspace',
					status: 'error',
					message: 'not a directory'
				});
			});
			return true;
		}
		return origSend(cmd);
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	await assert.rejects(() => hub.openRemoteProject('/no/such', handlers()));
	assert.equal(hub.listProjects().length, 0);
	assert.equal(
		fake.commands.some(c => c.type === 'CreateProject'),
		false
	);
	hub.closeAll();
});

test('openRemoteProject existing dir becomes ready after Register', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const snap = await hub.openRemoteProject('/home/kai/code', handlers());
	assert.equal(snap.path, '/home/kai/code');
	assert.equal(snap.status, 'ready');
	assert.ok(fake.commands.some(c => c.type === 'RegisterWorkspace' && c.path === '/home/kai/code'));
	assert.equal(
		fake.commands.some(c => c.type === 'CreateProject'),
		false
	);
	hub.closeAll();
});

test('Register timeout deletes the registering row', async () => {
	const fake = fakeBridge();
	fake.send = (cmd: BridgeCommand) => {
		fake.commands.push(cmd);
		return true;
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	await assert.rejects(() => hub.openRemoteProject('/home/kai/hung', handlers()), /timeout/i);
	assert.equal(hub.listProjects().length, 0);
	hub.closeAll();
});

test('listHostDir defaults to hostHome and hides .default_project', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const res = await hub.listHostDir();
	assert.equal(res.ok, true);
	if (res.ok) {
		assert.equal(res.home, '/home/kai');
		assert.equal(
			res.entries.some(e => e.name === '.default_project'),
			false
		);
		assert.ok(res.entries.some(e => e.name === 'code'));
	}
	hub.closeAll();
});

test('listHostDir unknown command falls back', async () => {
	const fake = fakeBridge();
	fake.send = (cmd: BridgeCommand) => {
		fake.commands.push(cmd);
		if (cmd.type === 'ListHostDir') {
			queueMicrotask(() => {
				fake.handlers?.onEvent({
					type: 'command_result',
					name: 'ListHostDir',
					status: 'error',
					requestId: cmd.requestId,
					message: 'Unknown command type: ListHostDir'
				});
			});
		}
		return true;
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const res = await hub.listHostDir('/home/kai');
	assert.equal(res.ok, false);
	if (!res.ok) {
		assert.equal(res.fallback, true);
		assert.equal(res.code, 'unknown-command');
	}
	hub.closeAll();
});

test('createHostDir sends parent+name and returns the created path', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const res = await hub.createHostDir('/home/kai', 'code');
	assert.equal(res.ok, true);
	if (res.ok) {
		assert.equal(res.path, '/home/kai/code');
		assert.equal(res.name, 'code');
	}
	assert.ok(
		fake.commands.some(
			c => c.type === 'CreateHostDir' && c.parent === '/home/kai' && c.name === 'code'
		)
	);
	hub.closeAll();
});

test('createHostDir unknown command does not drop the folder tree', async () => {
	const fake = fakeBridge();
	fake.send = (cmd: BridgeCommand) => {
		fake.commands.push(cmd);
		if (cmd.type === 'CreateHostDir') {
			queueMicrotask(() => {
				fake.handlers?.onEvent({
					type: 'command_result',
					name: 'CreateHostDir',
					status: 'error',
					requestId: cmd.requestId,
					message: 'Unknown command type: CreateHostDir'
				});
			});
		}
		return true;
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const res = await hub.createHostDir('/home/kai', 'code');
	assert.equal(res.ok, false);
	if (!res.ok) {
		assert.equal(res.code, 'unknown-command');
		assert.equal(res.fallback, true);
	}
	hub.closeAll();
});

test('createHostDir maps exists', async () => {
	const fake = fakeBridge();
	fake.send = (cmd: BridgeCommand) => {
		fake.commands.push(cmd);
		if (cmd.type === 'CreateHostDir') {
			queueMicrotask(() => {
				fake.handlers?.onEvent({
					type: 'command_result',
					name: 'CreateHostDir',
					status: 'error',
					requestId: cmd.requestId,
					message: 'exists',
					fs: {code: 'exists', home: '/home/kai'}
				});
			});
		}
		return true;
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const res = await hub.createHostDir('/home/kai', 'code');
	assert.equal(res.ok, false);
	if (!res.ok) assert.equal(res.code, 'exists');
	hub.closeAll();
});

test('listHostDir timeout is not fallback', async () => {
	const fake = fakeBridge();
	fake.send = (cmd: BridgeCommand) => {
		fake.commands.push(cmd);
		return true;
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const res = await hub.listHostDir('/home/kai');
	assert.equal(res.ok, false);
	if (!res.ok) {
		assert.equal(res.code, 'timeout');
		assert.equal(res.fallback, undefined);
	}
	hub.closeAll();
});

test('remote isDefault meta without rootPath adopts via hostHome', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	fake.handlers?.onEvent({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'default-project',
				projectType: 'general',
				displayName: 'Default Project',
				status: 'active',
				isDefault: true
			}
		],
		sessionsByProjectId: {}
	});
	assert.equal(hub.getDefaultProject()?.path, '/home/kai/fast_workspace/.default_project');
	assert.equal(hub.getDefaultProject()?.sessions.tasksHydrated, true);
	assert.equal(hub.listProjects().length, 0);
	hub.closeAll();
});

test('local hub refuses openRemoteProject and listHostDir', async () => {
	const home = mkdtempSync(path.join(tmpdir(), 'hub-local-home-'));
	mkdirSync(path.join(home, 'fast_workspace'), {recursive: true});
	const hub = new WorkspaceHub({
		createBridge: () => fakeBridge() as unknown as BridgeClient,
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-local-cwd-')),
		homeDir: home
	});
	await assert.rejects(() => hub.openRemoteProject('/home/kai/x', handlers()), /only available/);
	const listed = await hub.listHostDir();
	assert.equal(listed.ok, false);
	const created = await hub.createHostDir('/home/kai', 'x');
	assert.equal(created.ok, false);
	if (!created.ok) assert.equal(created.code, 'denied');
	hub.closeAll();
});

test('openRemoteProject rejects server .default_project', async () => {
	const fake = fakeBridge();
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	await assert.rejects(
		() => hub.openRemoteProject('/home/kai/fast_workspace/.default_project', handlers()),
		/hidden Default Project/
	);
	assert.equal(hub.listProjects().length, 0);
	hub.closeAll();
});

test('listHostDir maps file and missing fs codes', async () => {
	const fake = fakeBridge();
	fake.send = (cmd: BridgeCommand) => {
		fake.commands.push(cmd);
		if (cmd.type === 'ListHostDir') {
			const code = cmd.path?.includes('notes.txt') ? 'not-dir' : 'not-found';
			queueMicrotask(() => {
				fake.handlers?.onEvent({
					type: 'command_result',
					name: 'ListHostDir',
					status: 'error',
					requestId: cmd.requestId,
					message: code,
					fs: {code, home: '/home/kai'}
				});
			});
		}
		return true;
	};
	const hub = remoteHub(() => fake);
	hub.ensureEngine(handlers());
	await new Promise(r => setTimeout(r, 20));
	const file = await hub.listHostDir('/home/kai/notes.txt');
	assert.equal(file.ok, false);
	if (!file.ok) assert.equal(file.code, 'not-dir');
	const missing = await hub.listHostDir('/home/kai/nope');
	assert.equal(missing.ok, false);
	if (!missing.ok) assert.equal(missing.code, 'not-found');
	hub.closeAll();
});

test('hostSkillDiscovery on a missing remote path adds no project skills', () => {
	const found = discoverHostSlashSkills('/no/such/remote/workspace');
	assert.equal(
		found.some(s => s.badge === 'project'),
		false
	);
});
