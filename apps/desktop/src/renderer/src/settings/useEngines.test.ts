import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';
import type {EngineRow, EngAdminApi} from '@fastllm/bridge-client';
import {engNoticeKind, engStore} from './useEngines.js';

function row(partial: Partial<EngineRow> & {id: string}): EngineRow {
	return {
		kind: 'extension',
		adapter: 'disabled',
		program: 'missing',
		process: 'none',
		isDefault: false,
		inRegistry: false,
		actions: [],
		...partial
	};
}

function api(opts: Partial<EngAdminApi> = {}): EngAdminApi {
	return {
		listEngines: opts.listEngines ?? (async () => ({ok: true, engines: []})),
		enableEngine: opts.enableEngine ?? (async () => ({ok: true, engines: []})),
		disableEngine: opts.disableEngine ?? (async () => ({ok: true, engines: []})),
		startEngine: opts.startEngine ?? (async () => ({ok: true, engines: []})),
		stopEngine: opts.stopEngine ?? (async () => ({ok: true, engines: []})),
		setDefaultEngine: opts.setDefaultEngine ?? (async () => ({ok: true, engines: []})),
		installEngine: opts.installEngine ?? (async () => ({ok: true, engines: []})),
		uninstallEngine: opts.uninstallEngine ?? (async () => ({ok: true, engines: []})),
		cancelEngineInstall: opts.cancelEngineInstall ?? (async () => ({ok: true, engines: []})),
		onEngineInstallLog: opts.onEngineInstallLog
	};
}

beforeEach(() => {
	engStore.resetForTest();
});

test('engine not ready is disabled', async () => {
	engStore.bindApi(api({}));
	engStore.setEngineReady(false);
	assert.equal(engStore.getSnapshot().status, 'disabled');
	await engStore.list();
	assert.equal(engStore.getSnapshot().status, 'disabled');
});

test('list error is error status with notice', async () => {
	engStore.bindApi(api({listEngines: async () => ({ok: false, notice: 'bridge down'})}));
	engStore.setEngineReady(true);
	await engStore.list();
	const view = engStore.getSnapshot();
	assert.equal(view.status, 'error');
	assert.equal(view.notice, 'bridge down');
});

test('list ready projects three axes and default', async () => {
	engStore.bindApi(
		api({
			listEngines: async () => ({
				ok: true,
				engines: [
					row({
						id: 'fast',
						kind: 'builtin',
						adapter: 'ready',
						program: 'builtin',
						process: 'none',
						isDefault: true,
						inRegistry: true
					}),
					row({id: 'dsh', adapter: 'disabled', program: 'missing', process: 'none'})
				]
			})
		})
	);
	engStore.setEngineReady(true);
	await engStore.list();
	const view = engStore.getSnapshot();
	assert.equal(view.status, 'ready');
	assert.equal(view.engines.find(r => r.id === 'fast')?.isDefault, true);
	assert.equal(view.engines.find(r => r.id === 'dsh')?.adapter, 'disabled');
	assert.equal(view.engines.find(r => r.id === 'fast')?.program, 'builtin');
});

test('write success merges engines by id without a second list', async () => {
	let listed = 0;
	engStore.bindApi(
		api({
			listEngines: async () => {
				listed += 1;
				return {
					ok: true,
					engines: [row({id: 'dsh', adapter: 'ready', program: 'installed', process: 'stopped'})]
				};
			},
			startEngine: async () => ({
				ok: true,
				engines: [
					row({
						id: 'dsh',
						adapter: 'ready',
						program: 'installed',
						process: 'running',
						processDetail: '127.0.0.1:3080',
						inRegistry: true,
						actions: ['stop']
					})
				]
			})
		})
	);
	engStore.setEngineReady(true);
	await engStore.list();
	const listsAfterReady = listed;
	assert.equal(await engStore.start('dsh'), true);
	const dsh = engStore.getSnapshot().engines.find(r => r.id === 'dsh');
	assert.equal(dsh?.process, 'running');
	assert.equal(dsh?.processDetail, '127.0.0.1:3080');
	assert.equal(dsh?.actions[0], 'stop');
	assert.equal(listed, listsAfterReady);
});

test('write failure keeps prior rows and sets notice', async () => {
	engStore.bindApi(
		api({
			listEngines: async () => ({
				ok: true,
				engines: [row({id: 'dsh', adapter: 'ready', program: 'installed', process: 'running'})]
			}),
			disableEngine: async () => ({ok: false, notice: 'Busy'})
		})
	);
	engStore.setEngineReady(true);
	await engStore.list();
	assert.equal(await engStore.disable('dsh'), false);
	const view = engStore.getSnapshot();
	assert.equal(view.notice, 'Busy');
	assert.equal(view.engines.find(r => r.id === 'dsh')?.process, 'running');
	assert.equal(engNoticeKind('Busy'), 'Busy');
});

test('install is optimistic installing and late logs do not rewind installed', async () => {
	let finishInstall: ((value: {ok: true; engines: EngineRow[]}) => void) | null = null;
	const handlers: Array<(log: {engineId: string; stream: 'stdout' | 'stderr'; text: string; seq: number}) => void> =
		[];
	engStore.bindApi(
		api({
			listEngines: async () => ({ok: true, engines: [row({id: 'dsh', program: 'missing'})]}),
			onEngineInstallLog: handler => {
				handlers.push(handler);
				return () => undefined;
			},
			installEngine: () =>
				new Promise(resolve => {
					finishInstall = resolve;
				})
		})
	);
	engStore.setEngineReady(true);
	await engStore.list();
	const pending = engStore.install('dsh');
	assert.equal(engStore.getSnapshot().engines.find(r => r.id === 'dsh')?.program, 'installing');
	assert.equal(engStore.getSnapshot().engines.find(r => r.id === 'dsh')?.actions[0], 'cancel');
	for (const h of handlers) {
		h({engineId: 'dsh', stream: 'stdout', text: 'downloading', seq: 1});
	}
	finishInstall?.({
		ok: true,
		engines: [row({id: 'dsh', program: 'installed', actions: ['start'], installLog: []})]
	});
	assert.equal(await pending, true);
	for (const h of handlers) {
		h({engineId: 'dsh', stream: 'stdout', text: 'late', seq: 2});
	}
	const after = engStore.getSnapshot().engines.find(r => r.id === 'dsh');
	assert.equal(after?.program, 'installed');
	assert.equal(after?.installLog?.at(-1)?.text, 'late');
});

test('install logs append then result replaces program', async () => {
	const handlers: Array<(log: {engineId: string; stream: 'stdout' | 'stderr'; text: string; seq: number}) => void> =
		[];
	engStore.bindApi(
		api({
			listEngines: async () => ({
				ok: true,
				engines: [row({id: 'dsh', program: 'missing'})]
			}),
			onEngineInstallLog: handler => {
				handlers.push(handler);
				return () => undefined;
			},
			installEngine: async () => ({
				ok: true,
				engines: [row({id: 'dsh', program: 'installed', installLog: []})]
			}),
			cancelEngineInstall: async () => ({
				ok: true,
				engines: [row({id: 'dsh', program: 'missing'})]
			})
		})
	);
	engStore.setEngineReady(true);
	await engStore.list();
	for (const h of handlers) {
		h({engineId: 'dsh', stream: 'stdout', text: 'a', seq: 1});
		h({engineId: 'dsh', stream: 'stderr', text: 'b', seq: 2});
		h({engineId: 'dsh', stream: 'stdout', text: 'c', seq: 3});
	}
	assert.equal(engStore.getSnapshot().engines.find(r => r.id === 'dsh')?.installLog?.length, 3);
	assert.equal(await engStore.install('dsh'), true);
	const after = engStore.getSnapshot().engines.find(r => r.id === 'dsh');
	assert.equal(after?.program, 'installed');
	assert.equal(after?.installLog?.length, 3);
});

test('cancel during install sends CancelEngineInstall and row returns missing', async () => {
	const handlers: Array<(log: {engineId: string; stream: 'stdout' | 'stderr'; text: string; seq: number}) => void> =
		[];
	let cancelled = 0;
	engStore.bindApi(
		api({
			listEngines: async () => ({ok: true, engines: [row({id: 'dsh', program: 'missing'})]}),
			onEngineInstallLog: handler => {
				handlers.push(handler);
				return () => undefined;
			},
			cancelEngineInstall: async () => {
				cancelled += 1;
				return {ok: true, engines: [row({id: 'dsh', program: 'missing'})]};
			}
		})
	);
	engStore.setEngineReady(true);
	await engStore.list();
	for (const h of handlers) {
		h({engineId: 'dsh', stream: 'stdout', text: 'a', seq: 1});
	}
	assert.equal(await engStore.cancelInstall('dsh'), true);
	assert.equal(cancelled, 1);
	assert.equal(engStore.getSnapshot().engines.find(r => r.id === 'dsh')?.program, 'missing');
});

test('store does not subscribe to engineStatus meta', () => {
	const apiShape = api({});
	assert.equal('onEngineStatus' in apiShape, false);
	assert.equal('onEngineInstallLog' in apiShape, true);
});

test('status keys stay on the four locale keys', () => {
	const keys = ['running', 'available', 'notReady', 'failed'] as const;
	assert.deepEqual([...keys], ['running', 'available', 'notReady', 'failed']);
});
