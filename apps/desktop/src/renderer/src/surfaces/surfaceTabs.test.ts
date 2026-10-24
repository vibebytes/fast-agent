import assert from 'node:assert/strict';
import test from 'node:test';
import type {ExtRow, SurfaceWire} from '@fastllm/bridge-client';
import {
	dropSurfaceTabs,
	patchSurfaceState,
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
