import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';
import type {ExtNote, ExtRow} from '@fastllm/bridge-client';
import {extStore, noticeKind} from './useExtensions.js';

type ListOk = {ok: true; extensions: ExtRow[]; ledger: ExtNote[]};
type Err = {ok: false; notice: string};

function row(id: string, phase: ExtRow['phase'] = 'Active', hotUnload = true): ExtRow {
	return {id, phase, hotUnload};
}

function api(opts: {
	list?: () => Promise<ListOk | Err>;
	status?: (id: string) => Promise<{ok: true; extension: ExtRow | null} | Err>;
	install?: (dir: string) => Promise<{ok: true; id: string} | Err>;
	uninstall?: (id: string) => Promise<{ok: true} | Err>;
	pick?: () => Promise<string | null>;
}) {
	return {
		listExtensions: opts.list ?? (async () => ({ok: true as const, extensions: [], ledger: []})),
		extensionStatus: opts.status ?? (async () => ({ok: true as const, extension: null})),
		installExtension: opts.install ?? (async (dir: string) => ({ok: true as const, id: dir})),
		uninstallExtension: opts.uninstall ?? (async () => ({ok: true as const})),
		pickExtensionDir: opts.pick ?? (async () => '/tmp/probe')
	};
}

beforeEach(() => {
	extStore.resetForTest();
});

test('engine not ready is disabled', async () => {
	extStore.bindApi(api({}));
	extStore.setEngineReady(false);
	assert.equal(extStore.getSnapshot().status, 'disabled');
	await extStore.list();
	assert.equal(extStore.getSnapshot().status, 'disabled');
});

test('list error is error status with notice', async () => {
	extStore.bindApi(api({list: async () => ({ok: false, notice: 'bridge down'})}));
	extStore.setEngineReady(true);
	await extStore.list();
	const view = extStore.getSnapshot();
	assert.equal(view.status, 'error');
	assert.equal(view.notice, 'bridge down');
});

test('list ready projects ledger and restartHint', async () => {
	extStore.bindApi(
		api({
			list: async () => ({
				ok: true,
				extensions: [row('memory', 'Active', false), row('probe')],
				ledger: [
					{id: 'memory', mark: 'put'},
					{id: 'probe', mark: 'put'}
				]
			})
		})
	);
	extStore.setEngineReady(true);
	await extStore.list();
	const view = extStore.getSnapshot();
	assert.equal(view.status, 'ready');
	assert.equal(view.extensions.find(r => r.id === 'memory')?.restartHint, '需重启');
	assert.equal(view.extensions.find(r => r.id === 'probe')?.restartHint, undefined);
	assert.deepEqual(
		view.ledger.map(n => n.mark),
		['put', 'put']
	);
});

test('noticeKind maps known faults; unknown stays Unknown', () => {
	assert.equal(noticeKind('需重启'), 'NeedsRestart');
	assert.equal(noticeKind('Busy'), 'Busy');
	assert.equal(noticeKind('ExtOpFault.Busy'), 'Busy');
	assert.equal(noticeKind('DescFault(InvalidYaml)'), 'DescFault');
	assert.equal(noticeKind('remote url forbidden'), 'RemoteUrl');
	assert.equal(noticeKind('denied'), 'Denied');
	assert.equal(noticeKind('engine not ready'), 'EngineDown');
	assert.equal(noticeKind('DrainTimeout'), 'Unknown');
	assert.equal(noticeKind('apiVersion mismatch'), 'Unknown');
});

test('known faults stay on notice; unknown notice is kept verbatim', async () => {
	for (const notice of ['需重启', 'Busy', 'DescFault(BadId)', 'remote url forbidden']) {
		extStore.resetForTest();
		extStore.bindApi(api({uninstall: async () => ({ok: false, notice})}));
		extStore.setEngineReady(true);
		await extStore.list();
		const ok = await extStore.uninstall('probe');
		assert.equal(ok, false);
		assert.equal(extStore.getSnapshot().notice, notice);
	}
	extStore.resetForTest();
	extStore.bindApi(api({uninstall: async () => ({ok: false, notice: 'DrainTimeout'})}));
	extStore.setEngineReady(true);
	await extStore.list();
	const ok = await extStore.uninstall('probe');
	assert.equal(ok, false);
	assert.equal(extStore.getSnapshot().notice, 'DrainTimeout');
	assert.equal(noticeKind('DrainTimeout'), 'Unknown');
});

test('install and uninstall refresh list', async () => {
	let listed = 0;
	const rows: ExtRow[] = [];
	const ledger: ExtNote[] = [];
	extStore.bindApi(
		api({
			list: async () => {
				listed += 1;
				return {ok: true, extensions: [...rows], ledger: [...ledger]};
			},
			install: async dir => {
				const id = dir.split('/').at(-1) ?? dir;
				rows.push(row(id));
				ledger.push({id, mark: 'put'});
				return {ok: true, id};
			},
			uninstall: async id => {
				const idx = rows.findIndex(r => r.id === id);
				if (idx >= 0) rows.splice(idx, 1);
				ledger.push({id, mark: 'drop'});
				return {ok: true};
			},
			pick: async () => '/tmp/probe'
		})
	);
	extStore.setEngineReady(true);
	await extStore.list();
	assert.equal(await extStore.install(), true);
	assert.equal(extStore.getSnapshot().extensions[0]?.id, 'probe');
	assert.equal(extStore.getSnapshot().ledger.at(-1)?.mark, 'put');
	assert.equal(await extStore.uninstall('probe'), true);
	assert.equal(extStore.getSnapshot().extensions.length, 0);
	assert.equal(extStore.getSnapshot().ledger.at(-1)?.mark, 'drop');
	assert.ok(listed >= 3);
});

test('statusOf patches a row from ExtensionStatus', async () => {
	extStore.bindApi(
		api({
			list: async () => ({
				ok: true,
				extensions: [row('probe', 'Installed', false)],
				ledger: []
			}),
			status: async id => ({
				ok: true,
				extension: row(id, 'Active', false)
			})
		})
	);
	extStore.setEngineReady(true);
	await extStore.list();
	assert.equal(extStore.getSnapshot().extensions[0]?.phase, 'Installed');
	const st = await extStore.statusOf('probe');
	assert.equal(st?.phase, 'Active');
	assert.equal(st?.restartHint, '需重启');
	assert.equal(extStore.getSnapshot().extensions[0]?.phase, 'Active');
});

test('list throw becomes error and does not stay loading', async () => {
	extStore.bindApi(api({list: async () => Promise.reject(new Error('socket closed'))}));
	extStore.setEngineReady(true);
	await extStore.list();
	const view = extStore.getSnapshot();
	assert.equal(view.status, 'error');
	assert.equal(view.notice, 'socket closed');
});

test('standalone first-install fail marks Failed and reinstall recovers', async () => {
	let installOk = false;
	const rows: ExtRow[] = [];
	extStore.bindApi(
		api({
			list: async () => ({ok: true, extensions: [...rows], ledger: []}),
			install: async dir => {
				if (!installOk) return {ok: false, notice: 'DescFault(InvalidYaml)'};
				const id = dir.split('/').at(-1) ?? dir;
				rows.push(row(id));
				return {ok: true, id};
			},
			pick: async () => '/tmp/probe'
		})
	);
	extStore.setEngineReady(true);
	await extStore.list();
	assert.equal(await extStore.install(), false);
	const failed = extStore.getSnapshot();
	assert.equal(failed.failed?.id, 'probe');
	assert.equal(failed.failed?.dir, '/tmp/probe');
	assert.equal(failed.extensions.find(r => r.id === 'probe')?.phase, 'Failed');
	assert.equal(failed.notice, 'DescFault(InvalidYaml)');
	installOk = true;
	assert.equal(await extStore.reinstall('probe'), true);
	const recovered = extStore.getSnapshot();
	assert.equal(recovered.failed, null);
	assert.equal(recovered.extensions.find(r => r.id === 'probe')?.phase, 'Active');
});

test('standalone install fail keeps live row Active', async () => {
	extStore.bindApi(
		api({
			list: async () => ({ok: true, extensions: [row('memory')], ledger: []}),
			install: async () => ({ok: false, notice: 'Busy'}),
			pick: async () => '/tmp/memory'
		})
	);
	extStore.setEngineReady(true);
	await extStore.list();
	assert.equal(await extStore.install(), false);
	const view = extStore.getSnapshot();
	assert.equal(view.failed, null);
	assert.equal(view.extensions.find(r => r.id === 'memory')?.phase, 'Active');
	assert.equal(view.notice, 'Busy');
});

test('upgrade from installed records adjacent drop+put', async () => {
	const rows = [row('probe')];
	const ledger: ExtNote[] = [{id: 'probe', mark: 'put'}];
	extStore.bindApi(
		api({
			list: async () => ({ok: true, extensions: [...rows], ledger: [...ledger]}),
			uninstall: async id => {
				const idx = rows.findIndex(r => r.id === id);
				if (idx >= 0) rows.splice(idx, 1);
				ledger.push({id, mark: 'drop'});
				return {ok: true};
			},
			install: async dir => {
				const id = dir.split('/').at(-1) ?? dir;
				rows.push(row(id));
				ledger.push({id, mark: 'put'});
				return {ok: true, id};
			},
			pick: async () => '/tmp/probe'
		})
	);
	extStore.setEngineReady(true);
	await extStore.list();
	assert.equal(await extStore.upgrade('probe'), true);
	const marks = extStore.getSnapshot().ledger.map(n => n.mark);
	assert.deepEqual(marks.slice(-2), ['drop', 'put']);
	assert.equal(marks.filter(m => m === 'drop').length, 1);
});

test('upgrade pick cancel does not mark Failed', async () => {
	const rows = [row('probe')];
	extStore.bindApi(
		api({
			list: async () => ({ok: true, extensions: [...rows], ledger: []}),
			uninstall: async id => {
				const idx = rows.findIndex(r => r.id === id);
				if (idx >= 0) rows.splice(idx, 1);
				return {ok: true};
			},
			pick: async () => null
		})
	);
	extStore.setEngineReady(true);
	await extStore.list();
	assert.equal(await extStore.upgrade('probe'), false);
	const view = extStore.getSnapshot();
	assert.equal(view.failed, null);
	assert.equal(view.extensions.find(r => r.id === 'probe'), undefined);
});

test('upgrade install fail marks Failed and reinstall recovers', async () => {
	let installOk = false;
	const rows = [row('probe')];
	const ledger: ExtNote[] = [{id: 'probe', mark: 'put'}];
	extStore.bindApi(
		api({
			list: async () => ({ok: true, extensions: [...rows], ledger: [...ledger]}),
			uninstall: async id => {
				const idx = rows.findIndex(r => r.id === id);
				if (idx >= 0) rows.splice(idx, 1);
				ledger.push({id, mark: 'drop'});
				return {ok: true};
			},
			install: async dir => {
				if (!installOk) return {ok: false, notice: 'DescFault(InvalidYaml)'};
				const id = dir.split('/').at(-1) ?? dir;
				rows.push(row(id));
				ledger.push({id, mark: 'put'});
				return {ok: true, id};
			},
			pick: async () => '/tmp/probe'
		})
	);
	extStore.setEngineReady(true);
	await extStore.list();
	assert.equal(await extStore.upgrade('probe'), false);
	const failed = extStore.getSnapshot();
	assert.equal(failed.failed?.id, 'probe');
	assert.equal(failed.failed?.dir, '/tmp/probe');
	assert.equal(failed.extensions.find(r => r.id === 'probe')?.phase, 'Failed');
	assert.equal(failed.notice, 'DescFault(InvalidYaml)');
	installOk = true;
	assert.equal(await extStore.reinstall('probe'), true);
	const recovered = extStore.getSnapshot();
	assert.equal(recovered.failed, null);
	assert.equal(recovered.extensions.find(r => r.id === 'probe')?.phase, 'Active');
	assert.equal(recovered.ledger.filter(n => n.mark === 'put').length, 2);
	assert.equal(recovered.ledger.filter(n => n.mark === 'drop').length, 1);
});
