import assert from 'node:assert/strict';
import test from 'node:test';
import type {ExtRow, SurfaceWire} from '@fastllm/bridge-client';
import {
	applySurfaceOpen,
	dropSurfaceTabs,
	patchSurfaceState,
	surfaceCloseKey,
	surfaceEntries,
	surfaceRunnable,
	surfaceTab,
	surfaceTabId,
	upsertSurfaceTab
} from './surfaceTabs.js';
import type {RailTab} from '../railTabs.js';

function surface(partial: Partial<SurfaceWire>): SurfaceWire {
	return {
		id: 'vibe3d.editor',
		title: 'Vibe3D',
		slot: 'pane',
		kind: 'web',
		capabilities: ['tool.call'],
		order: 10,
		singleton: true,
		state: 'ready',
		...partial
	};
}

function row(partial: Partial<ExtRow> & {surfaces?: SurfaceWire[]}): ExtRow {
	const {surfaces, ...rest} = partial;
	return {
		id: 'vibe3d',
		phase: 'Active',
		hotUnload: true,
		provides: surfaces ? {surfaces} : undefined,
		...rest
	};
}

test('surfaceEntries lists Active pane web surfaces sorted by order then title', () => {
	const rows = [
		row({
			surfaces: [
				surface({id: 'b', title: 'Beta', order: 20}),
				surface({id: 'a', title: 'Alpha', order: 10})
			]
		})
	];
	assert.deepEqual(
		surfaceEntries(rows).map(e => e.surfaceId),
		['a', 'b']
	);
});

test('surfaceEntries skips rows that are not Active or not pane/web', () => {
	const rows = [
		row({id: 'installed', phase: 'Installed', surfaces: [surface({})]}),
		row({id: 'failed', phase: 'Failed', fault: 'Missing(tool)', surfaces: [surface({})]}),
		row({id: 'mcpapp', surfaces: [surface({id: 'x', kind: 'mcp-app'})]}),
		row({id: 'vibe3d', surfaces: [surface({id: 'vibe3d.editor'})]})
	];
	assert.deepEqual(
		surfaceEntries(rows).map(e => `${e.extId}:${e.surfaceId}`),
		['vibe3d:vibe3d.editor']
	);
});

test('surfaceEntries carries state and capabilities from the declaration', () => {
	const rows = [row({surfaces: [surface({state: 'down', capabilities: ['tool.call', 'clipboard']})]})];
	const [entry] = surfaceEntries(rows);
	assert.equal(entry.state, 'down');
	assert.deepEqual(entry.capabilities, ['tool.call', 'clipboard']);
	assert.equal(entry.title, 'Vibe3D');
});

test('surfaceTabId namespaces by extension and surface', () => {
	assert.equal(surfaceTabId('vibe3d', 'vibe3d.editor'), 'surface:vibe3d:vibe3d.editor');
});

test('surfaceTab builds a surface rail tab that starts without a url', () => {
	const tab = surfaceTab({extId: 'vibe3d', surfaceId: 'vibe3d.editor', title: 'Vibe3D'});
	assert.equal(tab.kind, 'surface');
	assert.equal(tab.id, 'surface:vibe3d:vibe3d.editor');
	assert.equal(tab.title, 'Vibe3D');
	assert.deepEqual(tab.surface, {
		extId: 'vibe3d',
		surfaceId: 'vibe3d.editor',
		state: 'unknown',
		capabilities: []
	});
});

test('surfaceRunnable only accepts ready', () => {
	assert.equal(surfaceRunnable('ready'), true);
	assert.equal(surfaceRunnable('unknown'), false);
	assert.equal(surfaceRunnable('down'), false);
	assert.equal(surfaceRunnable('error'), false);
});

test('patchSurfaceState patches the matching tab only', () => {
	const tabs: RailTab[] = [
		surfaceTab({extId: 'vibe3d', surfaceId: 'vibe3d.editor', title: 'Vibe3D'}),
		surfaceTab({extId: 'other', surfaceId: 'other.pane', title: 'Other'})
	];
	const next = patchSurfaceState(tabs, {
		extId: 'vibe3d',
		surfaceId: 'vibe3d.editor',
		state: 'down',
		detail: 'health timeout'
	});
	assert.equal(next[0].surface?.state, 'down');
	assert.equal(next[0].surface?.detail, 'health timeout');
	assert.equal(next[1].surface?.state, 'unknown');
});

test('upsertSurfaceTab keeps one tab per surface and replaces the url', () => {
	const first = surfaceTab({extId: 'vibe3d', surfaceId: 'vibe3d.editor', title: 'Vibe3D'});
	const opened = {...first, surface: {...first.surface!, url: 'http://127.0.0.1:7345/r/kitchen'}};
	let tabs = upsertSurfaceTab([], opened);
	tabs = upsertSurfaceTab(tabs, {
		...first,
		surface: {...first.surface!, url: 'http://127.0.0.1:7345/r/living'}
	});
	assert.equal(tabs.length, 1);
	assert.equal(tabs[0].surface?.url, 'http://127.0.0.1:7345/r/living');
});

test('dropSurfaceTabs removes every tab owned by the extension', () => {
	const tabs: RailTab[] = [
		surfaceTab({extId: 'vibe3d', surfaceId: 'vibe3d.editor', title: 'Vibe3D'}),
		surfaceTab({extId: 'vibe3d', surfaceId: 'vibe3d.preview', title: 'Preview'}),
		surfaceTab({extId: 'other', surfaceId: 'other.pane', title: 'Other'})
	];
	assert.deepEqual(
		dropSurfaceTabs(tabs, 'vibe3d').map(t => t.id),
		['surface:other:other.pane']
	);
});

const OPEN = {
	extId: 'vibe3d',
	surfaceId: 'vibe3d.editor',
	url: 'http://127.0.0.1:7345/?t=tok',
	instanceKey: 'vibe3d.editor',
	title: 'Vibe3D'
};

test('applySurfaceOpen creates and focuses a tab for a new surface', () => {
	const outcome = applySurfaceOpen([], OPEN, new Set());
	assert.equal(outcome.focusId, 'surface:vibe3d:vibe3d.editor');
	assert.equal(outcome.tabs.length, 1);
	assert.equal(outcome.tabs[0].surface?.url, OPEN.url);
	assert.equal(outcome.tabs[0].surface?.instanceKey, OPEN.instanceKey);
	assert.equal(outcome.tabs[0].title, 'Vibe3D');
});

test('applySurfaceOpen replay with the same instance keeps the tab and never steals focus', () => {
	const first = applySurfaceOpen([], OPEN, new Set());
	const second = applySurfaceOpen(first.tabs, OPEN, new Set());
	assert.equal(second.focusId, null);
	assert.equal(second.tabs, first.tabs);
});

test('applySurfaceOpen refreshes the url and focuses when the instance url changes', () => {
	const first = applySurfaceOpen([], OPEN, new Set());
	const second = applySurfaceOpen(first.tabs, {...OPEN, url: 'http://127.0.0.1:8000/?t=tok2'}, new Set());
	assert.equal(second.focusId, 'surface:vibe3d:vibe3d.editor');
	assert.equal(second.tabs.length, 1);
	assert.equal(second.tabs[0].surface?.url, 'http://127.0.0.1:8000/?t=tok2');
});

test('applySurfaceOpen refreshes the grant and focuses when the instanceKey changes', () => {
	const first = applySurfaceOpen([], OPEN, new Set());
	const second = applySurfaceOpen(first.tabs, {...OPEN, instanceKey: 'vibe3d.editor#2'}, new Set());
	assert.equal(second.focusId, 'surface:vibe3d:vibe3d.editor');
	assert.equal(second.tabs[0].surface?.instanceKey, 'vibe3d.editor#2');
});

test('applySurfaceOpen keeps the declared title when the replay has none', () => {
	const declared = surfaceTab({extId: 'vibe3d', surfaceId: 'vibe3d.editor', title: 'Vibe3D'});
	const opened = {...declared, surface: {...declared.surface!, url: OPEN.url, instanceKey: OPEN.instanceKey}};
	const replayed = applySurfaceOpen([opened], {...OPEN, title: undefined}, new Set());
	assert.equal(replayed.focusId, null);
	assert.equal(replayed.tabs[0].title, 'Vibe3D');
});

test('applySurfaceOpen skips a replay whose exact instance the user closed', () => {
	const first = applySurfaceOpen([], OPEN, new Set());
	const closed = new Set([surfaceCloseKey(first.tabs[0].surface!)]);
	const outcome = applySurfaceOpen([], OPEN, closed);
	assert.equal(outcome.tabs.length, 0);
	assert.equal(outcome.focusId, null);
});

test('applySurfaceOpen reopens with a new url after the user closed the old instance', () => {
	const first = applySurfaceOpen([], OPEN, new Set());
	const closed = new Set([surfaceCloseKey(first.tabs[0].surface!)]);
	const outcome = applySurfaceOpen([], {...OPEN, url: 'http://127.0.0.1:8000/?t=tok2'}, closed);
	assert.equal(outcome.focusId, 'surface:vibe3d:vibe3d.editor');
	assert.equal(outcome.tabs[0].surface?.url, 'http://127.0.0.1:8000/?t=tok2');
});

test('applySurfaceOpen focuses the first real open after a placeholder was closed', () => {
	const closed = new Set([surfaceCloseKey({extId: 'vibe3d', surfaceId: 'vibe3d.editor'})]);
	const outcome = applySurfaceOpen([], OPEN, closed);
	assert.equal(outcome.focusId, 'surface:vibe3d:vibe3d.editor');
});

test('applySurfaceOpen merges roomId on a replay without stealing focus', () => {
	const first = applySurfaceOpen([], OPEN, new Set());
	const second = applySurfaceOpen(first.tabs, {...OPEN, roomId: 'r_ab12cd34'}, new Set());
	assert.equal(second.focusId, null);
	assert.equal(second.tabs[0].surface?.roomId, 'r_ab12cd34');
});
