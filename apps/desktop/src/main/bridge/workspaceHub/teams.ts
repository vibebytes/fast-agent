/** WorkspaceHub tests — living / Teams surface. Loaded by WorkspaceHub.test.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WorkspaceHub} from '../WorkspaceHub.js';
import {isDefaultProjectPath, defaultProjectPath} from '../defaultProject.js';
import {projectHash} from '../projectHash.js';
import {assertSkillCommandPinned} from '../skillSlashContract.js';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {
	type FakeBridge,
	createFakeBridge,
	noopHandlers,
	engineRow,
	settleReadyEngines
} from './kit.js';

test('openLivingSession selects by sessionId and focuses owning Project', async () => {
	const commands: BridgeCommand[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => createFakeBridge(commands),
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const a = mkdtempSync(path.join(tmpdir(), 'proj-a-'));
	const b = mkdtempSync(path.join(tmpdir(), 'proj-b-'));
	hub.openProject(a, noopHandlers());
	hub.openProject(b, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const projA = hub.getById(hub.listProjects().find(p => p.path === a)!.id)!;
	const projB = hub.getById(hub.listProjects().find(p => p.path === b)!.id)!;
	const taskA = projA.sessions.createTask('A');
	projA.sessions.acceptNewSession('sess-living-a', taskA.id);
	hub.focusProject(projB.id);

	const hit = hub.openLivingSession('sess-living-a');
	assert.equal(hit.ok, true);
	if (!hit.ok) return;
	assert.equal(hit.taskId, taskA.id);
	assert.equal(hub.getActive()?.id, projA.id);
	assert.equal(projA.sessions.getActiveTask()?.id, taskA.id);

	const miss = hub.openLivingSession('sess-missing');
	assert.equal(miss.ok, false);

	const byMeta = hub.openLivingSession('sess-living-a', projA.metaProjectId);
	assert.equal(byMeta.ok, true);

	const metaMiss = hub.openLivingSession('sess-missing', 'no-such-meta');
	assert.equal(metaMiss.ok, false);
	hub.closeAll();
});

test('listLivingTasks resolves host command_result (no session demux steal)', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const root = mkdtempSync(path.join(tmpdir(), 'proj-living-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 80));

	const pending = hub.listLivingTasks();
	await new Promise(r => setTimeout(r, 20));
	assert.ok(commands.some(c => c.type === 'ListLivingTasks'));

	bridge!.__inject({
		type: 'command_result',
		name: 'ListLivingTasks',
		message: '1 projects',
		status: 'accepted',
		livingTasks: [
			{
				projectId: 'meta-p1',
				displayName: 'Demo',
				sessions: []
			}
		]
	});

	const result = await pending;
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.projects[0]?.projectId, 'meta-p1');
	assert.equal(result.projects[0]?.displayName, 'Demo');
	hub.closeAll();
});
