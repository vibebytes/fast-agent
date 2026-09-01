import assert from 'node:assert/strict';
import {describe, it, beforeEach} from 'node:test';
import type {SettingsDoc} from '@fast-ide/session-view';
import {
	agentsDoc,
	clampVerdictAttempts,
	generalDoc,
	modelsDoc,
	settingsStore
} from './useSettings.js';

describe('settings payload narrowing', () => {
	it('generalDoc fills defaults for missing fields', () => {
		assert.deepEqual(generalDoc({}), {
			restoreWorkspace: true,
			notifications: true,
			soundPrompt: true,
			approvalSound: true,
			experimental: false
		});
		assert.deepEqual(generalDoc({restoreWorkspace: false, experimental: true}), {
			restoreWorkspace: false,
			notifications: true,
			soundPrompt: true,
			approvalSound: true,
			experimental: true
		});
		assert.deepEqual(generalDoc({approvalSound: false}), {
			restoreWorkspace: true,
			notifications: true,
			soundPrompt: true,
			approvalSound: false,
			experimental: false
		});
	});

	it('modelsDoc keeps only known string/boolean fields', () => {
		assert.deepEqual(modelsDoc({}), {});
		assert.deepEqual(
			modelsDoc({
				defaultPlatform: ' openrouter ',
				defaultModel: 'deepseek',
				defaultEffort: 'high',
				defaultThinking: true,
				extra: 1
			}),
			{
				defaultPlatform: 'openrouter',
				defaultModel: 'deepseek',
				defaultEffort: 'high',
				defaultThinking: true
			}
		);
	});

	it('agentsDoc defaults to follow and narrows fixed bindings', () => {
		assert.deepEqual(agentsDoc({}), {
			subagent: {mode: 'follow'},
			scheduled: {mode: 'follow'},
			goalControl: {mode: 'follow'},
			goalWork: {mode: 'follow'},
			memory: {mode: 'follow', enabled: true},
			goal: {onMissingVerdict: 'block', verdictAttempts: 3}
		});
		assert.deepEqual(
			agentsDoc({
				subagent: {mode: 'fixed', platformId: ' deepseek ', modelId: ' v4 '},
				scheduled: {mode: 'fixed', platformId: ' openrouter ', modelId: ' terra '},
				goalControl: {mode: 'follow'},
				goalWork: {mode: 'nope'},
				memory: {mode: 'fixed', platformId: ' openrouter ', modelId: ' terra ', enabled: false},
				goal: {onMissingVerdict: 'fail', verdictAttempts: 5}
			}),
			{
				subagent: {mode: 'fixed', platformId: 'deepseek', modelId: 'v4'},
				scheduled: {mode: 'fixed', platformId: 'openrouter', modelId: 'terra'},
				goalControl: {mode: 'follow'},
				goalWork: {mode: 'follow'},
				memory: {mode: 'fixed', platformId: 'openrouter', modelId: 'terra', enabled: false},
				goal: {onMissingVerdict: 'fail', verdictAttempts: 5}
			}
		);
	});

	it('agentsDoc defaults memory to enabled follow when omitted', () => {
		assert.deepEqual(agentsDoc({subagent: {mode: 'follow'}}).memory, {
			mode: 'follow',
			enabled: true
		});
	});

	it('agentsDoc clamps verdictAttempts and treats unknown onMissing as block', () => {
		assert.deepEqual(agentsDoc({goal: {onMissingVerdict: 'nope', verdictAttempts: 0}}).goal, {
			onMissingVerdict: 'block',
			verdictAttempts: 1
		});
		assert.equal(agentsDoc({goal: {verdictAttempts: 99}}).goal.verdictAttempts, 20);
		assert.equal(agentsDoc({goal: {verdictAttempts: '5'}}).goal.verdictAttempts, 5);
		assert.equal(agentsDoc({goal: {verdictAttempts: 'nope'}}).goal.verdictAttempts, 3);
	});

	it('clampVerdictAttempts ignores empty so the field can be cleared while typing', () => {
		assert.equal(clampVerdictAttempts(''), undefined);
		assert.equal(clampVerdictAttempts('  '), undefined);
		assert.equal(clampVerdictAttempts('nope'), undefined);
		assert.equal(clampVerdictAttempts(0), 1);
		assert.equal(clampVerdictAttempts(10), 10);
		assert.equal(clampVerdictAttempts(99), 20);
	});
});

describe('settingsStore optimistic patch', () => {
	beforeEach(() => {
		settingsStore.resetForTest();
	});

	it('patches optimistically and rolls back on failure', async () => {
		const docs: SettingsDoc[] = [
			{
				scope: 'global',
				scopeId: 'default',
				namespace: 'general',
				payload: {
					restoreWorkspace: true,
					notifications: true,
					soundPrompt: true,
					approvalSound: true,
					experimental: false
				},
				schemaVersion: 1
			}
		];
		let fail = false;
		settingsStore.bindApi({
			getSettings: async () => ({ok: true, settings: docs}),
			patchSettings: async (_scope, _ns, patch) => {
				if (fail) return {ok: false, notice: 'boom'};
				const payload = {
					...(docs[0]!.payload as Record<string, unknown>),
					...(patch as Record<string, unknown>)
				};
				docs[0] = {...docs[0]!, payload};
				return {
					ok: true,
					setting: docs[0]!
				};
			}
		});
		settingsStore.setEngineReady(true);
		await settingsStore.load();
		assert.equal(settingsStore.getSnapshot().general.restoreWorkspace, true);

		fail = true;
		const ok = await settingsStore.patchGeneral({restoreWorkspace: false});
		assert.equal(ok, false);
		assert.equal(settingsStore.getSnapshot().general.restoreWorkspace, true);
		assert.equal(settingsStore.getSnapshot().notice, 'boom');

		fail = false;
		const ok2 = await settingsStore.patchGeneral({restoreWorkspace: false});
		assert.equal(ok2, true);
		assert.equal(settingsStore.getSnapshot().general.restoreWorkspace, false);
		assert.equal(settingsStore.getSnapshot().notice, null);
	});

	it('quiet reload keeps ready status while fetching', async () => {
		const docs: SettingsDoc[] = [
			{
				scope: 'global',
				scopeId: 'default',
				namespace: 'general',
				payload: {
					restoreWorkspace: true,
					notifications: true,
					soundPrompt: true,
					approvalSound: true,
					experimental: false
				},
				schemaVersion: 1
			}
		];
		let holdNext = false;
		let resolveHeld!: (v: {ok: true; settings: SettingsDoc[]}) => void;
		settingsStore.bindApi({
			getSettings: () => {
				if (holdNext) {
					holdNext = false;
					return new Promise(resolve => {
						resolveHeld = resolve;
					});
				}
				return Promise.resolve({ok: true, settings: docs});
			},
			patchSettings: async () => ({ok: false, notice: 'unused'})
		});
		settingsStore.setEngineReady(true);
		await settingsStore.load();
		assert.equal(settingsStore.getSnapshot().status, 'ready');

		holdNext = true;
		const quiet = settingsStore.load({quiet: true});
		assert.equal(settingsStore.getSnapshot().status, 'ready');
		resolveHeld({ok: true, settings: docs});
		await quiet;
		assert.equal(settingsStore.getSnapshot().status, 'ready');
	});
});
