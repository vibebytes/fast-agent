import assert from 'node:assert/strict';
import test from 'node:test';
import {openExistingFolder} from './openExistingFolder.js';

test('openExistingFolder uses the remote dialog, not the local picker', async () => {
	const events: string[] = [];
	let openedLocal = false;
	const prev = globalThis.window;
	(globalThis as {window: typeof window}).window = {
		fastIde: {
			listEdges: async () => ({
				activeId: 'edge-1',
				pendingEdgeId: null,
				servers: [],
				capabilities: {
					canOpenLocalFolder: false,
					canCreateLocalProject: false,
					canOpenRemoteFolder: true
				}
			}),
			openProject: async () => {
				openedLocal = true;
				return '/tmp';
			}
		},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: (event: Event) => {
			events.push(event.type);
			return true;
		}
	} as unknown as Window & typeof globalThis;
	try {
		await openExistingFolder();
		assert.deepEqual(events, ['fast-ide:open-remote-folder']);
		assert.equal(openedLocal, false);
	} finally {
		(globalThis as {window: typeof prev}).window = prev;
	}
});

test('openExistingFolder stays put while an edge switch is pending', async () => {
	let openedLocal = false;
	const events: string[] = [];
	const prev = globalThis.window;
	(globalThis as {window: typeof window}).window = {
		fastIde: {
			listEdges: async () => ({
				activeId: 'local',
				pendingEdgeId: 'edge-1',
				servers: [],
				capabilities: {
					canOpenLocalFolder: true,
					canCreateLocalProject: true,
					canOpenRemoteFolder: false
				}
			}),
			openProject: async () => {
				openedLocal = true;
				return '/tmp';
			}
		},
		dispatchEvent: (event: Event) => {
			events.push(event.type);
			return true;
		}
	} as unknown as Window & typeof globalThis;
	try {
		await openExistingFolder();
		assert.deepEqual(events, []);
		assert.equal(openedLocal, false);
	} finally {
		(globalThis as {window: typeof prev}).window = prev;
	}
});
