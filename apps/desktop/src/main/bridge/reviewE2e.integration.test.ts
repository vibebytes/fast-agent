import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {WorkspaceHub} from './WorkspaceHub';
import {BridgeClient} from './BridgeClient.js';
import {projectHash} from './projectHash';

/**
 * Real-engine E2E for the review/undo lane: spawns the mock engine over stdio
 * and drives the Hub end-to-end (openProject → engine ready → review ops).
 */

const mockEnginePath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../scripts/dev/mock-engine.mjs'
);
const projectRoot = mkdtempSync(path.join(tmpdir(), 'review-e2e-'));
const homeDir = mkdtempSync(path.join(tmpdir(), 'review-home-'));
const hash = projectHash(projectRoot);

type SeenEvent = {projectId: string; event: {type: string}};

const until = async <T>(
	probe: () => Promise<T>,
	pick: (t: T) => boolean,
	label: string,
	timeoutMs = 15_000
): Promise<T> => {
	const deadline = Date.now() + timeoutMs;
	let last: T | undefined;
	for (;;) {
		last = await probe();
		if (pick(last)) return last;
		if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
		await new Promise(resolve => setTimeout(resolve, 150));
	}
};

let hub: WorkspaceHub | null = null;
const seen: SeenEvent[] = [];

before(() => {
	process.env.FAST_ENGINE_COMMAND = process.execPath;
	process.env.FAST_ENGINE_ARGS = mockEnginePath;
	hub = new WorkspaceHub({
		homeDir,
		createBridge: () => new BridgeClient({transport: 'stdio'})
	});
});

after(() => {
	hub?.closeAll();
	rmSync(projectRoot, {recursive: true, force: true});
	rmSync(homeDir, {recursive: true, force: true});
});

test('review lifecycle over the real mock engine', async () => {
	assert.ok(hub);
	const snap = hub.openProject(projectRoot, {
		onEvent: (projectId, event) => seen.push({projectId, event}),
		onError: () => {},
		onExit: () => {}
	});

	// openProject registers the checkout; wait until review answers flow.
	const first = await until(
		() => hub!.listReviewChanges(snap.id),
		answer => answer.ok,
		'listReviewChanges ok'
	);
	assert.equal(first.ok, true);
	assert.equal(first.list.revision, 7);
	assert.equal(first.list.changes.length, 3);
	assert.deepEqual(first.list.changes.map(c => c.id), ['c-1', 'c-2', 'c-3']);
	assert.equal(first.list.checkpoints?.length, 1);
	assert.equal(first.list.checkpoints?.[0].id, 'ck-1');

	// Single change detail.
	const detail = await hub.getReviewChange(snap.id, 'c-1');
	assert.equal(detail.ok, true);
	if (detail.ok) {
		assert.equal(detail.change.path, 'src/a.ts');
		assert.equal(detail.change.state.kind, 'pending');
	}

	// Keep → engine pushes review_changed back to the Hub.
	const kept = await hub.keepReviewChanges(snap.id, ['c-1'], first.list.revision);
	assert.equal(kept.ok, true);
	await until(
		() => Promise.resolve(seen.find(e => e.event.type === 'review_changed' && e.projectId === snap.id)),
		Boolean,
		'review_changed push'
	);
	const listedAfterKeep = await hub.listReviewChanges(snap.id);
	assert.equal(listedAfterKeep.ok, true);
	if (listedAfterKeep.ok) {
		assert.equal(listedAfterKeep.list.changes.find(c => c.id === 'c-1')?.state.kind, 'kept');
	}

	// Undo preview: whole-tree revert of remaining pending changes (c-1 was kept
	// above, so only notes.md/binary.dat are still pending); binary excluded.
	const preview = await hub.previewRevert(snap.id, {target: 'whole', revision: 8});
	assert.equal(preview.ok, true);
	if (preview.ok) {
		assert.deepEqual(preview.preview.changes.map(c => c.path), ['notes.md', 'binary.dat']);
		assert.ok(preview.preview.excludedPaths.includes('binary.dat'));
		assert.equal(preview.preview.revision, 8);
	}

	// Apply → restoreId + tree_advanced push; redo restores pending state.
	const applied = await hub.applyRevert(snap.id, preview.ok ? preview.preview.id : '');
	assert.equal(applied.ok, true);
	if (applied.ok) {
		assert.match(applied.restored.restoreId, /^rs-/);
		assert.equal(applied.restored.revision, 9);
	}
	await until(
		() => Promise.resolve(seen.find(e => e.event.type === 'tree_advanced' && e.projectId === snap.id)),
		Boolean,
		'tree_advanced push'
	);

	const redone = await hub.redoRevert(snap.id, applied.ok ? applied.restored.restoreId : '');
	assert.equal(redone.ok, true);

	const final = await hub.listReviewChanges(snap.id);
	assert.equal(final.ok, true);
	if (final.ok) {
		assert.equal(final.list.revision, 10);
		// Redo re-applies only what ApplyRevert had reverted; kept changes stay kept.
		assert.equal(final.list.changes.find(c => c.id === 'c-2')?.state.kind, 'pending');
		assert.equal(final.list.changes.find(c => c.id === 'c-1')?.state.kind, 'kept');
	}
});
