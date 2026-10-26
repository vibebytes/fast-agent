import assert from 'node:assert/strict';
import test from 'node:test';
import type {ExtRow} from '@fastllm/bridge-client';
import {liveExtIds, unlistedSurfaceExtIds} from './surfaceSweep.js';
import {surfaceTab} from './surfaceTabs.js';
import type {RailTab} from '../railTabs.js';

function row(id: string, phase: ExtRow['phase']): ExtRow {
	return {id, phase, hotUnload: false};
}

function vibeTab(): RailTab {
	return surfaceTab({extId: 'vibe3d', surfaceId: 'vibe3d.editor', title: 'Vibe3D'});
}

test('liveExtIds keeps every phase except Uninstalled', () => {
	const live = liveExtIds([row('vibe3d', 'Failed'), row('memory', 'Installed'), row('old', 'Uninstalled')]);
	assert.deepEqual([...live], ['vibe3d', 'memory']);
});

test('扩展 Failed / Installed 时不得判定 tab 失效（安装重试窗口）', () => {
	const live = liveExtIds([row('vibe3d', 'Failed')]);
	assert.deepEqual(unlistedSurfaceExtIds([vibeTab()], live), []);
});

test('扩展不在快照里才算可疑，且按 extId 去重', () => {
	const tabs = [vibeTab(), surfaceTab({extId: 'vibe3d', surfaceId: 'vibe3d.other', title: 'x'})];
	assert.deepEqual(unlistedSurfaceExtIds(tabs, new Set()), ['vibe3d']);
});

test('非 surface tab 不参与清理', () => {
	const tabs = [{id: 'files', kind: 'files', title: 'Files', pinned: true} as RailTab];
	assert.deepEqual(unlistedSurfaceExtIds(tabs, new Set()), []);
});
