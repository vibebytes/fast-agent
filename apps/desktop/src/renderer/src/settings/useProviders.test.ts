import assert from 'node:assert/strict';
import test from 'node:test';
import {providersStore, type ModelPatch, type Provider} from './useProviders.js';

type Api = Parameters<typeof providersStore.bindApi>[0];
type PatchResult = Awaited<ReturnType<Api['patchProviderModels']>>;
type ListResult = Awaited<ReturnType<Api['listProviders']>>;

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(r => {
		resolve = r;
	});
	return {promise, resolve};
}

function provider(cache = true, image = false, id = 'p1'): Provider {
	return {
		id,
		kind: 'openai',
		vendor: 'openai',
		name: id,
		modelCount: 1,
		enabledModelCount: 1,
		enabled: true,
		models: [
			{
				modelId: 'm1',
				displayName: 'M1',
				enabled: true,
				source: 'manual',
				promptCacheKey: cache,
				...(image ? {inputModalities: ['text', 'image']} : {})
			}
		]
	};
}

function bind(overrides: Partial<Api>): void {
	providersStore.bindApi({
		listProviders: async () => ({ok: true, providers: [provider()]}),
		...overrides
	} as Api);
}

const tick = () => new Promise(resolve => setImmediate(resolve));

async function ready(): Promise<void> {
	providersStore.resetForTest();
	providersStore.setEngineReady(true);
	await tick();
	assert.equal(providersStore.getSnapshot().status, 'ready');
}

function model(id = 'p1'): NonNullable<Provider['models']>[number] {
	const row = providersStore.getSnapshot().providers.find(p => p.id === id)?.models?.[0];
	assert.ok(row);
	return row;
}

test('model switches update immediately without waiting for persistence', async () => {
	const write = deferred<PatchResult>();
	let calls = 0;
	bind({patchProviderModels: () => {
		calls += 1;
		return write.promise;
	}});
	await ready();
	let settled = false;
	const pending = providersStore.patchModels('p1', [
		{op: 'enable', modelId: 'm1', promptCacheKey: false}
	]);
	void pending.then(() => {
		settled = true;
	});
	assert.equal(model().promptCacheKey, false);
	await tick();
	assert.equal(settled, false);
	assert.equal(calls, 1);
	write.resolve({ok: true, provider: provider(false)});
	assert.equal(await pending, true);
});

test('same-provider patches are serial and an earlier response preserves the latest intent', async () => {
	const writes: Deferred<PatchResult>[] = [];
	const sent: ModelPatch[][] = [];
	bind({patchProviderModels: (_id, patch) => {
		sent.push(patch);
		const write = deferred<PatchResult>();
		writes.push(write);
		return write.promise;
	}});
	await ready();
	const first = providersStore.patchModels('p1', [
		{op: 'enable', modelId: 'm1', promptCacheKey: false}
	]);
	const second = providersStore.patchModels('p1', [
		{op: 'enable', modelId: 'm1', promptCacheKey: true}
	]);
	assert.equal(model().promptCacheKey, true);
	assert.equal(sent.length, 1);
	writes[0]!.resolve({ok: true, provider: provider(false)});
	assert.equal(await first, true);
	await tick();
	assert.equal(model().promptCacheKey, true);
	assert.equal(sent.length, 2);
	assert.equal(sent[1]![0]!.promptCacheKey, true);
	writes[1]!.resolve({ok: true, provider: provider(true)});
	assert.equal(await second, true);
	assert.equal(model().promptCacheKey, true);
});

test('an older failure does not roll back a newer model mutation', async () => {
	const writes: Deferred<PatchResult>[] = [];
	bind({patchProviderModels: () => {
		const write = deferred<PatchResult>();
		writes.push(write);
		return write.promise;
	}});
	await ready();
	const first = providersStore.patchModels('p1', [
		{op: 'enable', modelId: 'm1', promptCacheKey: false}
	]);
	const second = providersStore.patchModels('p1', [
		{op: 'enable', modelId: 'm1', inputModalities: ['text', 'image']}
	]);
	assert.equal(model().inputModalities?.includes('image'), true);
	writes[0]!.resolve({ok: false, notice: 'first write failed'});
	assert.equal(await first, false);
	await tick();
	assert.equal(model().promptCacheKey, true);
	assert.equal(model().inputModalities?.includes('image'), true);
	assert.equal(providersStore.getSnapshot().notice, 'first write failed');
	assert.equal(writes.length, 2);
	writes[1]!.resolve({ok: true, provider: provider(true, true)});
	assert.equal(await second, true);
	assert.equal(model().inputModalities?.includes('image'), true);
});

test('a rejected IPC write settles as failure and the queue continues', async () => {
	const second = deferred<PatchResult>();
	let calls = 0;
	bind({patchProviderModels: () => {
		calls += 1;
		return calls === 1 ? Promise.reject(new Error('IPC disconnected')) : second.promise;
	}});
	await ready();
	const first = providersStore.patchModels('p1', [
		{op: 'enable', modelId: 'm1', promptCacheKey: false}
	]);
	const queued = providersStore.patchModels('p1', [
		{op: 'enable', modelId: 'm1', inputModalities: ['text', 'image']}
	]);
	assert.equal(await first, false);
	await tick();
	assert.equal(model().promptCacheKey, true);
	assert.equal(model().inputModalities?.includes('image'), true);
	assert.equal(providersStore.getSnapshot().notice, 'IPC disconnected');
	assert.equal(calls, 2);
	second.resolve({ok: true, provider: provider(true, true)});
	assert.equal(await queued, true);
});

test('provider invalidation coalesces until pending patches drain', async () => {
	const write = deferred<PatchResult>();
	const refresh = deferred<ListResult>();
	let listCalls = 0;
	bind({
		listProviders: () => {
			listCalls += 1;
			return listCalls === 1 ? Promise.resolve({ok: true, providers: [provider()]}) : refresh.promise;
		},
		patchProviderModels: () => write.promise
	});
	await ready();
	const pending = providersStore.patchModels('p1', [
		{op: 'enable', modelId: 'm1', promptCacheKey: false}
	]);
	providersStore.invalidate();
	providersStore.invalidate();
	await tick();
	assert.equal(listCalls, 1);
	assert.equal(model().promptCacheKey, false);
	write.resolve({ok: true, provider: provider(false)});
	assert.equal(await pending, true);
	await tick();
	assert.equal(listCalls, 2);
	refresh.resolve({ok: true, providers: [provider(false)]});
	await tick();
	assert.equal(model().promptCacheKey, false);
	assert.equal(providersStore.getSnapshot().status, 'ready');
});

test('a list started before a patch cannot restore stale state after the write', async () => {
	const stale = deferred<ListResult>();
	const reconciled = deferred<ListResult>();
	const write = deferred<PatchResult>();
	let listCalls = 0;
	bind({
		listProviders: () => {
			listCalls += 1;
			if (listCalls === 1) return Promise.resolve({ok: true, providers: [provider()]});
			return listCalls === 2 ? stale.promise : reconciled.promise;
		},
		patchProviderModels: () => write.promise
	});
	await ready();
	const listing = providersStore.list({quiet: true});
	const pending = providersStore.patchModels('p1', [
		{op: 'enable', modelId: 'm1', promptCacheKey: false}
	]);
	write.resolve({ok: true, provider: provider(false)});
	assert.equal(await pending, true);
	assert.equal(model().promptCacheKey, false);
	stale.resolve({ok: true, providers: [provider(true)]});
	await listing;
	assert.equal(model().promptCacheKey, false);
	assert.equal(listCalls, 3);
	reconciled.resolve({ok: true, providers: [provider(false)]});
	await tick();
	assert.equal(model().promptCacheKey, false);
});

test('different providers persist independently', async () => {
	const writes = new Map<string, Deferred<PatchResult>>();
	bind({
		listProviders: async () => ({ok: true, providers: [provider(true, false, 'p1'), provider(true, false, 'p2')]}),
		patchProviderModels: id => {
			const write = deferred<PatchResult>();
			writes.set(id, write);
			return write.promise;
		}
	});
	await ready();
	const first = providersStore.patchModels('p1', [{op: 'enable', modelId: 'm1', promptCacheKey: false}]);
	const second = providersStore.patchModels('p2', [{op: 'enable', modelId: 'm1', promptCacheKey: false}]);
	assert.equal(writes.size, 2);
	writes.get('p2')!.resolve({ok: true, provider: provider(false, false, 'p2')});
	assert.equal(await second, true);
	assert.equal(model('p1').promptCacheKey, false);
	writes.get('p1')!.resolve({ok: true, provider: provider(false)});
	assert.equal(await first, true);
});
