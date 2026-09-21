/** WorkspaceHub tests — review routing and ops. Loaded by WorkspaceHub.test.ts. */
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

test('review_changed routes by pathHash to the owning Project, not the focused one', async () => {
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

	const a = mkdtempSync(path.join(tmpdir(), 'proj-a-'));
	const b = mkdtempSync(path.join(tmpdir(), 'proj-b-'));
	const seen: Array<{projectId: string; type: string}> = [];
	const watching = () => ({
		onEvent: (projectId: string, event: BridgeEvent) => seen.push({projectId, type: event.type}),
		onError: () => {},
		onExit: () => {}
	});
	hub.openProject(a, watching());
	hub.openProject(b, watching());
	await new Promise(r => setTimeout(r, 120));

	const list = hub.listProjects();
	const projA = hub.getById(list.find(p => p.path === a)!.id)!;
	const projB = hub.getById(list.find(p => p.path === b)!.id)!;
	hub.focusProject(projB.id);
	seen.length = 0;

	bridge!.__inject({
		type: 'review_changed',
		pathHash: projectHash(a),
		revision: 3
	} as BridgeEvent);
	await new Promise(r => setTimeout(r, 40));

	assert.deepEqual(seen, [{projectId: projA.id, type: 'review_changed'}]);

	// A hash no open Project owns is dropped rather than handed to whoever is focused.
	seen.length = 0;
	bridge!.__inject({type: 'review_changed', pathHash: 'nobody', revision: 4} as BridgeEvent);
	await new Promise(r => setTimeout(r, 40));
	assert.deepEqual(seen, []);
	hub.closeAll();
});

/**
 * Review replies carry no sessionId and no Meta projectId, so the checkout hash is the only thing
 * saying which of several open Projects an answer belongs to. Two lists in flight at once must not be
 * able to take each other's payload.
 */
test('review answers are matched by checkout, so two Projects cannot cross', async () => {
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
	const a = mkdtempSync(path.join(tmpdir(), 'proj-rev-a-'));
	const b = mkdtempSync(path.join(tmpdir(), 'proj-rev-b-'));
	hub.openProject(a, noopHandlers());
	hub.openProject(b, noopHandlers());
	await new Promise(r => setTimeout(r, 120));

	const list = hub.listProjects();
	const projA = hub.getById(list.find(p => p.path === a)!.id)!;
	const projB = hub.getById(list.find(p => p.path === b)!.id)!;

	const askedA = hub.listReviewChanges(projA.id);
	const askedB = hub.listReviewChanges(projB.id);
	await new Promise(r => setTimeout(r, 20));
	assert.equal(commands.filter(c => c.type === 'ListReviewChanges').length, 2);

	// Answer B's first: without hash matching, A's waiter is older and would swallow it.
	bridge!.__inject({
		type: 'command_result',
		name: 'ListReviewChanges',
		message: '1 change',
		status: 'success',
		pathHash: projectHash(b),
		review: {
			revision: 7,
			changes: [
				{
					id: 'chg-b',
					checkpointId: 'ckpt-b',
					path: 'b.txt',
					kind: 'modified',
					state: {kind: 'pending'}
				}
			]
		}
	} as unknown as BridgeEvent);
	bridge!.__inject({
		type: 'command_result',
		name: 'ListReviewChanges',
		message: '0 changes',
		status: 'success',
		pathHash: projectHash(a),
		review: {revision: 2, changes: []}
	} as unknown as BridgeEvent);

	const [answerA, answerB] = await Promise.all([askedA, askedB]);
	assert.ok(answerA.ok && answerB.ok);
	assert.equal(answerA.ok && answerA.list.revision, 2);
	assert.equal(answerB.ok && answerB.list.revision, 7);
	assert.deepEqual(answerB.ok && answerB.list.changes.map(c => c.path), ['b.txt']);
	hub.closeAll();
});

/** The session id rides the ListReviewChanges command so the daemon can scope the list to one session. */
test('listReviewChanges forwards the session id to the daemon', async () => {
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
	const root = mkdtempSync(path.join(tmpdir(), 'proj-rev-sid-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 120));
	const project = hub.getById(hub.listProjects()[0]!.id)!;

	const asked = hub.listReviewChanges(project.id, null, 'sess-42');
	await new Promise(r => setTimeout(r, 20));
	const sent = commands.find(c => c.type === 'ListReviewChanges');
	assert.ok(sent);
	assert.equal((sent as {sessionId?: string}).sessionId, 'sess-42');

	bridge!.__inject({
		type: 'command_result',
		name: 'ListReviewChanges',
		message: '0 changes',
		status: 'success',
		pathHash: projectHash(root),
		review: {revision: 1, changes: []}
	} as unknown as BridgeEvent);
	const answer = await asked;
	assert.ok(answer.ok);
	hub.closeAll();
});

/** Checkpoints off is not a failure to retry: nothing was recorded, so nothing can be undone. */
test('a review command on an unprotected workspace answers unavailable', async () => {
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
	const root = mkdtempSync(path.join(tmpdir(), 'proj-rev-off-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 120));
	const project = hub.getById(hub.listProjects()[0]!.id)!;

	const asked = hub.listReviewChanges(project.id);
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'ListReviewChanges',
		message: 'Workspace checkpoints are off',
		status: 'unavailable',
		pathHash: projectHash(root),
		review: {available: false}
	} as unknown as BridgeEvent);

	const answer = await asked;
	assert.equal(answer.ok, false);
	assert.equal(!answer.ok && answer.unavailable, true);
	hub.closeAll();
});

/** A decision made against a list that has moved is refused with the revision to resync to. */
test('a stale keep comes back with the revision the client must catch up to', async () => {
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
	const root = mkdtempSync(path.join(tmpdir(), 'proj-rev-stale-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 120));
	const project = hub.getById(hub.listProjects()[0]!.id)!;

	const asked = hub.keepReviewChanges(project.id, ['chg-1'], 1);
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'KeepChanges',
		message: 'the change list has moved on',
		status: 'rejected',
		pathHash: projectHash(root),
		review: {revision: 4}
	} as unknown as BridgeEvent);

	const answer = await asked;
	assert.equal(answer.ok, false);
	assert.equal(!answer.ok && answer.revision, 4);
	assert.equal(!answer.ok && answer.unavailable, undefined);
	hub.closeAll();
});
const reviewChangeRow = (over: Record<string, unknown> = {}) => ({
	id: 'chg-1',
	checkpointId: 'ckpt-1',
	path: 'a.ts',
	kind: 'modified',
	state: {kind: 'pending'},
	...over
});

test('review: keep then review_changed push re-reads; stale plan refuses with daemon revision', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const seen: BridgeEvent[] = [];
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands);
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const root = path.resolve(mkdtempSync(path.join(tmpdir(), 'proj-rev-keep-')));
	const project = hub.openProject(root, {
		onEvent: (projectId, event) => seen.push(event),
		onError: () => {},
		onExit: () => {}
	});
	await new Promise(r => setTimeout(r, 80));
	const hash = projectHash(root);
	const inject = (payload: Record<string, unknown>) =>
		bridge!.__inject({
			type: 'command_result',
			name: 'ListReviewChanges',
			message: 'fake',
			status: 'success',
			pathHash: hash,
			...payload
		});

	const listed = hub.listReviewChanges(project.id);
	await new Promise(r => setTimeout(r, 20));
	inject({
		review: {
			revision: 1,
			changes: [reviewChangeRow(), reviewChangeRow({id: 'chg-2', path: 'b.ts', kind: 'added'})]
		}
	});
	const listedAnswer = await listed;
	assert.equal(listedAnswer.ok, true);
	if (!listedAnswer.ok) return;
	assert.equal(listedAnswer.list.revision, 1);
	assert.equal(listedAnswer.list.changes.length, 2);

	const keep = hub.keepReviewChanges(project.id, ['chg-1'], 1);
	await new Promise(r => setTimeout(r, 20));
	assert.ok(
		commands.some(
			c =>
				c.type === 'KeepChanges' &&
				c.workspaceId === hash &&
				'changeIds' in c &&
				c.changeIds.join() === 'chg-1' &&
				c.revision === 1
		)
	);
	bridge!.__inject({
		type: 'command_result',
		name: 'KeepChanges',
		message: 'ok',
		status: 'success',
		pathHash: hash,
		review: {revision: 1}
	});
	assert.equal((await keep).ok, true);

	// A restore lands from another window: the push must reach this checkout's handlers.
	bridge!.__inject({type: 'review_changed', pathHash: hash, revision: 2});
	await new Promise(r => setTimeout(r, 20));
	assert.ok(seen.some(e => e.type === 'review_changed' && e.pathHash === hash));

	const relisted = hub.listReviewChanges(project.id);
	await new Promise(r => setTimeout(r, 20));
	inject({review: {revision: 2, changes: [reviewChangeRow({id: 'chg-2', path: 'b.ts', kind: 'added'})]}});
	const relistedAnswer = await relisted;
	assert.equal(relistedAnswer.ok, true);
	if (!relistedAnswer.ok) return;
	assert.equal(relistedAnswer.list.revision, 2);

	// Planning against a stale revision must come back refused, carrying the daemon revision.
	const plan = hub.previewRevert(project.id, {target: 'changes', revision: 1, changeIds: ['chg-2']});
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'PreviewRevert',
		message: 'stale',
		status: 'rejected',
		pathHash: hash,
		review: {revision: 2}
	});
	const planned = await plan;
	assert.equal(planned.ok, false);
	if (planned.ok) return;
	assert.equal(planned.revision, 2);
	hub.closeAll();
});

test('review: previewRevert → applyRevert → redoRevert round-trips preview and restore', async () => {
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
	const root = path.resolve(mkdtempSync(path.join(tmpdir(), 'proj-rev-undo-')));
	const project = hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	const hash = projectHash(root);

	const plan = hub.previewRevert(project.id, {target: 'changes', revision: 1, changeIds: ['chg-2']});
	await new Promise(r => setTimeout(r, 20));
	assert.ok(
		commands.some(
			c =>
				c.type === 'PreviewRevert' &&
				c.workspaceId === hash &&
				'changeIds' in c &&
				c.changeIds?.join() === 'chg-2' &&
				c.revision === 1
		)
	);
	bridge!.__inject({
		type: 'command_result',
		name: 'PreviewRevert',
		message: 'ok',
		status: 'success',
		pathHash: hash,
		review: {
			revision: 2,
			preview: {
				id: 'pv-1',
				target: {kind: 'changes', changeIds: ['chg-2']},
				revision: 2,
				changes: [{path: 'b.ts', kind: 'deleted', previousPath: null}],
				conflicts: [],
				excludedPaths: [],
				forcePaths: [],
				mergedPaths: []
			}
		}
	});
	const planned = await plan;
	assert.equal(planned.ok, true);
	if (!planned.ok) return;
	assert.equal(planned.preview.id, 'pv-1');

	const apply = hub.applyRevert(project.id, 'pv-1');
	await new Promise(r => setTimeout(r, 20));
	assert.ok(commands.some(c => c.type === 'ApplyRevert' && 'previewId' in c && c.previewId === 'pv-1'));
	bridge!.__inject({
		type: 'command_result',
		name: 'ApplyRevert',
		message: 'ok',
		status: 'success',
		pathHash: hash,
		review: {restored: {restoreId: 'rs-1', fromTree: 't1', toTree: 't2', revision: 3}}
	});
	const applied = await apply;
	assert.equal(applied.ok, true);
	if (!applied.ok) return;
	assert.equal(applied.restored.restoreId, 'rs-1');

	const redo = hub.redoRevert(project.id, 'rs-1');
	await new Promise(r => setTimeout(r, 20));
	assert.ok(commands.some(c => c.type === 'RedoRevert' && 'restoreId' in c && c.restoreId === 'rs-1'));
	bridge!.__inject({
		type: 'command_result',
		name: 'RedoRevert',
		message: 'ok',
		status: 'success',
		pathHash: hash,
		review: {restored: {restoreId: 'rs-1', fromTree: 't2', toTree: 't3', revision: 4}}
	});
	const redone = await redo;
	assert.equal(redone.ok, true);
	if (!redone.ok) return;
	assert.equal(redone.restored.revision, 4);
	hub.closeAll();
});

/** A review op issued before RegisterWorkspace settles parks, then proceeds once the hash lands. */
test('a review op racing RegisterWorkspace parks until the hash lands', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands, {holdRegister: true});
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const root = mkdtempSync(path.join(tmpdir(), 'proj-rev-park-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 120));
	const project = hub.getById(hub.listProjects()[0]!.id)!;
	assert.ok(!project.workspaceId);

	const asked = hub.listReviewChanges(project.id);
	await new Promise(r => setTimeout(r, 20));
	assert.ok(!commands.some(c => c.type === 'ListReviewChanges'));

	bridge!.__releaseRegisters();
	await new Promise(r => setTimeout(r, 20));
	const sent = commands.find(c => c.type === 'ListReviewChanges');
	assert.ok(sent);
	assert.equal((sent as {workspaceId?: string}).workspaceId, projectHash(root));

	bridge!.__inject({
		type: 'command_result',
		name: 'ListReviewChanges',
		message: '0 changes',
		status: 'success',
		pathHash: projectHash(root),
		review: {revision: 1, changes: []}
	} as unknown as BridgeEvent);
	const answer = await asked;
	assert.ok(answer.ok);
	hub.closeAll();
});

/**
 * 18:55 remount: Register minted agent_work (2cb2e3a3323b) but ListReviewChanges
 * still named cli (ce4a5bb09bcc). Meta pathHash is not a Slot — do not send it.
 */
test('review ignores a Meta pathHash that is not this folder and waits for Register', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands, {holdRegister: true});
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const opened = mkdtempSync(path.join(tmpdir(), 'proj-agent-work-'));
	const sibling = mkdtempSync(path.join(tmpdir(), 'proj-cli-'));
	hub.openProject(opened, noopHandlers());
	await new Promise(r => setTimeout(r, 80));
	const project = hub.getById(hub.listProjects().find(p => p.path === opened)!.id)!;

	bridge!.__inject({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'proj-opened',
				projectType: 'coding',
				displayName: 'opened',
				isDefault: false,
				status: 'active',
				workspace: {
					id: 'ws-opened',
					placement: 'local',
					rootPath: opened,
					pathHash: projectHash(sibling)
				}
			}
		],
		sessionsByProjectId: {}
	} as BridgeEvent);
	await new Promise(r => setTimeout(r, 20));
	assert.notEqual(project.workspaceId, projectHash(sibling));

	const asked = hub.listReviewChanges(project.id);
	await new Promise(r => setTimeout(r, 20));
	assert.ok(
		!commands.some(
			c =>
				c.type === 'ListReviewChanges' &&
				(c as {workspaceId?: string}).workspaceId === projectHash(sibling)
		),
		'must not review a sibling folder hash from Meta'
	);

	bridge!.__releaseRegisters();
	await new Promise(r => setTimeout(r, 20));
	const sent = commands.find(c => c.type === 'ListReviewChanges') as
		| {workspaceId?: string}
		| undefined;
	assert.ok(sent);
	assert.equal(sent.workspaceId, projectHash(opened));
	assert.equal(project.slotLive, true);

	bridge!.__inject({
		type: 'command_result',
		name: 'ListReviewChanges',
		message: '0 changes',
		status: 'success',
		pathHash: projectHash(opened),
		review: {revision: 1, changes: []}
	} as unknown as BridgeEvent);
	const answer = await asked;
	assert.ok(answer.ok);

	// A later workspace_meta must not replace the Register-minted hash with a sibling's.
	bridge!.__inject({
		type: 'workspace_meta',
		tenantId: 'default',
		appId: 'default-app',
		projects: [
			{
				id: 'proj-opened',
				projectType: 'coding',
				displayName: 'opened',
				isDefault: false,
				status: 'active',
				workspace: {
					id: 'ws-opened',
					placement: 'local',
					rootPath: opened,
					pathHash: projectHash(sibling)
				}
			}
		],
		sessionsByProjectId: {}
	} as BridgeEvent);
	await new Promise(r => setTimeout(r, 20));
	assert.equal(project.workspaceId, projectHash(opened));
	assert.equal(project.slotLive, true);
	hub.closeAll();
});

/** A failed RegisterWorkspace must fail parked review ops instead of leaving them hanging. */
test('a failed RegisterWorkspace refuses parked review ops', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands, {holdRegister: true});
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const root = mkdtempSync(path.join(tmpdir(), 'proj-rev-fail-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 120));
	const project = hub.getById(hub.listProjects()[0]!.id)!;

	const asked = hub.listReviewChanges(project.id);
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'RegisterWorkspace',
		message: 'slot busy',
		status: 'error'
	} as unknown as BridgeEvent);
	const answer = await asked;
	assert.equal(answer.ok, false);
	if (answer.ok) return;
	assert.match(answer.notice, /slot busy/);
	hub.closeAll();
});

/** After a failed RegisterWorkspace, later review ops fail fast instead of re-waiting 12s. */
test('a failed RegisterWorkspace makes later review ops fail fast without re-registering', async () => {
	const commands: BridgeCommand[] = [];
	let bridge: FakeBridge | null = null;
	const hub = new WorkspaceHub({
		createBridge: () => {
			bridge = createFakeBridge(commands, {holdRegister: true});
			return bridge;
		},
		hostCwd: mkdtempSync(path.join(tmpdir(), 'hub-host-')),
		homeDir: mkdtempSync(path.join(tmpdir(), 'hub-home-'))
	});
	const root = mkdtempSync(path.join(tmpdir(), 'proj-rev-failfast-'));
	hub.openProject(root, noopHandlers());
	await new Promise(r => setTimeout(r, 120));
	const project = hub.getById(hub.listProjects()[0]!.id)!;

	// First op parks on RegisterWorkspace, then the daemon rejects it.
	const first = hub.listReviewChanges(project.id);
	await new Promise(r => setTimeout(r, 20));
	bridge!.__inject({
		type: 'command_result',
		name: 'RegisterWorkspace',
		message: 'slot busy',
		status: 'error'
	} as unknown as BridgeEvent);
	const firstAnswer = await first;
	assert.equal(firstAnswer.ok, false);

	// Second op must fail fast with the same reason and NOT re-send RegisterWorkspace.
	const registersBefore = commands.filter(c => c.type === 'RegisterWorkspace').length;
	const second = hub.listReviewChanges(project.id);
	const secondAnswer = await second;
	assert.equal(secondAnswer.ok, false);
	if (secondAnswer.ok) return;
	assert.match(secondAnswer.notice, /slot busy/);
	assert.equal(
		commands.filter(c => c.type === 'RegisterWorkspace').length,
		registersBefore,
		'failed registration must not be re-sent for a later op'
	);
	hub.closeAll();
});
