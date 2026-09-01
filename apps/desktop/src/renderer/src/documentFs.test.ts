import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';
import {
	applyConflictChoice,
	missingDocumentPatch,
	probeDisk,
	saveDocument
} from './documentFs.js';
import type {RailTab} from './railTabs.js';

const baseTab = (): RailTab => ({
	id: 't1',
	kind: 'document',
	title: 'a.txt',
	filePath: 'a.txt',
	baseContent: 'base',
	savedMtimeMs: 100,
	savedBytes: 4,
	dirty: true,
	editorEpoch: 0
});

describe('applyConflictChoice', () => {
	it('unclean merge arms CAS but leaves markers for saveDocument to block', () => {
		const applied = applyConflictChoice('merge', {
			tab: baseTab(),
			ours: 'ours-line',
			diskContent: 'disk-line',
			diskMtime: 999,
			diskBytes: 9
		});
		assert.ok(applied);
		assert.equal(applied.patch.savedMtimeMs, 999);
		assert.equal(applied.patch.savedBytes, 9);
		assert.equal(applied.patch.dirty, true);
		assert.match(applied.buffer ?? '', /<<<<<<</);
	});

	it('clean merge arms CAS', () => {
		const applied = applyConflictChoice('merge', {
			tab: baseTab(),
			ours: 'same',
			diskContent: 'same',
			diskMtime: 999,
			diskBytes: 4
		});
		assert.ok(applied);
		assert.equal(applied.patch.savedMtimeMs, 999);
		assert.equal(applied.patch.savedBytes, 4);
	});
});

describe('saveDocument', () => {
	const original = globalThis.window;

	afterEach(() => {
		(globalThis as {window?: unknown}).window = original;
	});

	function stubFastIde(api: {
		saveWorkspaceFile: (...args: unknown[]) => Promise<unknown>;
		getWorkspaceFile?: (...args: unknown[]) => Promise<unknown>;
	}) {
		(globalThis as {window: unknown}).window = {
			alert: () => {},
			fastIde: api
		};
	}

	it('blocks save when conflict markers remain', async () => {
		let called = 0;
		stubFastIde({
			saveWorkspaceFile: async () => {
				called += 1;
				return {ok: true, mtime: 1, bytes: 1};
			}
		});
		const patch = await saveDocument({
			tab: baseTab(),
			content: '<<<<<<< Ours\nx\n=======\ny\n>>>>>>> Disk',
			buffer: null,
			choose: async () => 'cancel'
		});
		assert.equal(patch, null);
		assert.equal(called, 0);
	});

	it('missing clears CAS cursor for recreate', async () => {
		stubFastIde({
			saveWorkspaceFile: async () => ({ok: false, error: 'missing', code: 'missing'})
		});
		const patch = await saveDocument({
			tab: baseTab(),
			content: 'new body',
			buffer: null,
			choose: async () => 'cancel'
		});
		assert.deepEqual(patch, missingDocumentPatch());
		assert.equal(patch?.savedMtimeMs, undefined);
		assert.equal(patch?.dirty, true);
	});
});

describe('probeDisk', () => {
	const original = globalThis.window;

	afterEach(() => {
		(globalThis as {window?: unknown}).window = original;
	});

	function stubGet(result: unknown) {
		(globalThis as {window: unknown}).window = {
			fastIde: {
				getWorkspaceFile: async () => result
			}
		};
	}

	it('noop when mtime and bytes match', async () => {
		stubGet({ok: true, content: 'base', mtime: 100, bytes: 4});
		const r = await probeDisk(baseTab(), null);
		assert.equal(r.kind, 'noop');
	});

	it('missing when disk gone', async () => {
		stubGet({ok: false, error: 'missing', code: 'missing'});
		const r = await probeDisk(baseTab(), null);
		assert.equal(r.kind, 'missing');
	});

	it('silent reload when clean tab and disk advanced', async () => {
		stubGet({ok: true, content: 'disk', mtime: 200, bytes: 4});
		const r = await probeDisk({...baseTab(), dirty: false}, null);
		assert.equal(r.kind, 'silent');
		if (r.kind === 'silent') {
			assert.equal(r.content, 'disk');
			assert.equal(r.mtime, 200);
		}
	});

	it('conflict when dirty and content differs', async () => {
		stubGet({ok: true, content: 'disk', mtime: 200, bytes: 4});
		const r = await probeDisk(
			{...baseTab(), dirty: true, baseContent: 'base'},
			{getValue: () => 'ours'} as never
		);
		assert.equal(r.kind, 'conflict');
		if (r.kind === 'conflict') {
			assert.equal(r.diskContent, 'disk');
			assert.equal(r.diskMtime, 200);
		}
	});

	it('advance-cursor when dirty but disk text still equals base', async () => {
		stubGet({ok: true, content: 'base', mtime: 200, bytes: 4});
		const r = await probeDisk(
			{...baseTab(), dirty: true, baseContent: 'base'},
			{getValue: () => 'ours'} as never
		);
		assert.equal(r.kind, 'advance-cursor');
		if (r.kind === 'advance-cursor') {
			assert.equal(r.mtime, 200);
			assert.equal(r.bytes, 4);
		}
	});
});
