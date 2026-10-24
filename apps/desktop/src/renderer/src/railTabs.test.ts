import assert from 'node:assert/strict';
import test from 'node:test';
import {FILES_TAB_ID, filesTab, mcpAppTab, withdrawMcpAppTabs, type RailTab} from './railTabs.js';

function documentTab(id: string): RailTab {
	return {id, kind: 'document', title: id, filePath: `${id}.md`};
}

const live = (server: string, uri: string) => ({server, resourceUri: uri});

test('unknown discovery keeps every app tab untouched', () => {
	const tabs = [filesTab(), mcpAppTab('blender', 'ui://a.html', 'A')];
	const result = withdrawMcpAppTabs(tabs, null, tabs[1]!.id);
	assert.equal(result.tabs, tabs);
	assert.equal(result.activeId, tabs[1]!.id);
});

test('an empty live set withdraws every app tab and leaves the rest', () => {
	const tabs = [filesTab(), documentTab('doc'), mcpAppTab('blender', 'ui://a.html', 'A')];
	const result = withdrawMcpAppTabs(tabs, new Set(), tabs[2]!.id);
	assert.deepEqual(
		result.tabs.map(t => t.id),
		[FILES_TAB_ID, 'doc']
	);
	assert.equal(result.activeId, FILES_TAB_ID);
});

test('only the live server + resource pair survives', () => {
	const tabs = [
		filesTab(),
		mcpAppTab('blender', 'ui://a.html', 'A'),
		mcpAppTab('blender', 'ui://b.html', 'B'),
		mcpAppTab('other', 'ui://a.html', 'C')
	];
	const result = withdrawMcpAppTabs(tabs, new Set(['blender\u0000ui://b.html']), FILES_TAB_ID);
	assert.deepEqual(
		result.tabs.map(t => t.mcpResourceUri ?? t.kind),
		['files', 'ui://b.html']
	);
	assert.equal(result.activeId, FILES_TAB_ID);
});

test('an active tab that survives keeps focus', () => {
	const tabs = [filesTab(), mcpAppTab('blender', 'ui://a.html', 'A'), documentTab('doc')];
	const result = withdrawMcpAppTabs(tabs, new Set(['blender\u0000ui://a.html']), tabs[1]!.id);
	assert.equal(result.tabs.length, 3);
	assert.equal(result.activeId, tabs[1]!.id);
});

test('live keys ignore the tab title so a renamed tab is not withdrawn', () => {
	const tabs = [mcpAppTab('blender', 'ui://a.html', 'old title')];
	const result = withdrawMcpAppTabs(tabs, new Set(['blender\u0000ui://a.html']), FILES_TAB_ID);
	assert.equal(result.tabs[0]?.title, 'old title');
});

test('surviving tabs are the same objects so React can skip re-rendering them', () => {
	const kept = mcpAppTab('blender', 'ui://a.html', 'A');
	const result = withdrawMcpAppTabs([filesTab(), kept], new Set(['blender\u0000ui://a.html']), FILES_TAB_ID);
	assert.equal(result.tabs[1], kept);
});

test('a live set matching nothing still returns a stable reference', () => {
	const tabs = [filesTab()];
	const result = withdrawMcpAppTabs(tabs, new Set(['blender\u0000ui://a.html']), FILES_TAB_ID);
	assert.equal(result.tabs, tabs);
});
