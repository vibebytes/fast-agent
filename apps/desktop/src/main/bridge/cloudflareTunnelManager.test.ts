import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	CloudflareTunnelManager,
	type CloudflareTunnelHandle,
	type CloudflareTunnelManagerDeps,
	type CloudflareTunnelStatus,
} from './cloudflareTunnelManager.js';

class FakeTunnel implements CloudflareTunnelHandle {
	listeners: Record<string, Array<(...args: any[]) => void>> = {};
	stopped = 0;

	on(event: string, listener: (...args: any[]) => void) {
		(this.listeners[event] ??= []).push(listener);
		return this;
	}

	emit(event: string, ...args: any[]) {
		for (const l of this.listeners[event] ?? []) l(...args);
	}

	stop() {
		this.stopped += 1;
		return true;
	}
}

function makeManager(overrides: Partial<CloudflareTunnelManagerDeps> = {}) {
	const tunnels: FakeTunnel[] = [];
	const statuses: CloudflareTunnelStatus[] = [];
	const manager = new CloudflareTunnelManager({
		originUrl: 'http://127.0.0.1:1981/bridge',
		getServerKey: () => 'sk-1',
		createTunnel: () => {
			const t = new FakeTunnel();
			tunnels.push(t);
			return t;
		},
		urlTimeoutMs: 20,
		crashBackoffMs: 5,
		maxCrashRestarts: 3,
		stopGraceMs: 20,
		onStatus: (s) => statuses.push(s),
		...overrides,
	});
	return {manager, tunnels, statuses};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('start → url → ready（generation 递增、serverKey 下发）', () => {
	const {manager, tunnels} = makeManager();
	const s1 = manager.start();
	assert.equal(s1.state, 'starting');
	assert.equal(s1.generation, 1);
	tunnels[0].emit('url', 'https://abc-123.trycloudflare.com');
	const s2 = manager.getStatus();
	assert.equal(s2.state, 'ready');
	assert.equal(s2.url, 'https://abc-123.trycloudflare.com/bridge');
	assert.equal(s2.serverKey, 'sk-1');
	assert.equal(s2.generation, 2);
	assert.ok(s2.startedAt > 0);
});

test('start 单飞幂等：starting/ready 不重复拉起', () => {
	const {manager, tunnels} = makeManager();
	manager.start();
	const s = manager.start();
	assert.equal(s.state, 'starting');
	assert.equal(tunnels.length, 1);
	tunnels[0].emit('url', 'https://x.trycloudflare.com');
	manager.start();
	assert.equal(tunnels.length, 1);
});

test('stop 幂等 + exit 归位 disabled', () => {
	const {manager, tunnels} = makeManager();
	manager.start();
	tunnels[0].emit('url', 'https://x.trycloudflare.com');
	const s1 = manager.stop();
	assert.equal(s1.state, 'stopping');
	assert.equal(tunnels[0].stopped, 1);
	const s2 = manager.stop();
	assert.equal(s2.state, 'stopping');
	assert.equal(tunnels[0].stopped, 1);
	tunnels[0].emit('exit', 0, null);
	assert.equal(manager.getStatus().state, 'disabled');
});

test('stop 后到达的 url 被忽略', () => {
	const {manager, tunnels} = makeManager();
	manager.start();
	manager.stop();
	tunnels[0].emit('url', 'https://x.trycloudflare.com');
	assert.equal(manager.getStatus().state, 'stopping');
});

test('stop 无 exit 事件 → stopGrace 兜底 disabled', async () => {
	const {manager} = makeManager({stopGraceMs: 10});
	manager.start();
	manager.stop();
	await sleep(30);
	assert.equal(manager.getStatus().state, 'disabled');
});

test('URL 超时 → failed(timeout)', async () => {
	const {manager} = makeManager({urlTimeoutMs: 10});
	manager.start();
	await sleep(30);
	const s = manager.getStatus();
	assert.equal(s.state, 'failed');
	assert.equal(s.code, 'timeout');
});

test('createTunnel 抛错 → failed(spawn)', () => {
	const {manager} = makeManager({
		createTunnel: () => {
			throw new Error('boom');
		},
	});
	manager.start();
	const s = manager.getStatus();
	assert.equal(s.state, 'failed');
	assert.equal(s.code, 'spawn');
});

test('二进制缺失 ENOENT → failed(download)', () => {
	const {manager, tunnels} = makeManager();
	manager.start();
	const err = Object.assign(new Error('spawn cloudflared ENOENT'), {code: 'ENOENT'});
	tunnels[0].emit('error', err);
	const s = manager.getStatus();
	assert.equal(s.state, 'failed');
	assert.equal(s.code, 'download');
});

test('崩溃退避重启，超限 failed(crash)', async () => {
	const {manager, tunnels} = makeManager({crashBackoffMs: 5, maxCrashRestarts: 3});
	manager.start();
	assert.equal(tunnels.length, 1);
	for (let i = 0; i < 3; i++) {
		tunnels[i].emit('exit', 1, null);
		assert.equal(manager.getStatus().state, 'starting');
		await sleep(15);
		assert.equal(tunnels.length, i + 2);
	}
	tunnels[3].emit('exit', 1, null);
	const s = manager.getStatus();
	assert.equal(s.state, 'failed');
	assert.equal(s.code, 'crash');
	assert.equal(s.generation, 5);
});

test('failed 后可重新 start', async () => {
	const {manager, tunnels} = makeManager({urlTimeoutMs: 10});
	manager.start();
	await sleep(30);
	assert.equal(manager.getStatus().state, 'failed');
	manager.start();
	assert.equal(manager.getStatus().state, 'starting');
	assert.equal(tunnels.length, 2);
});

test('dispose 兜底清理：停进程、清定时器、disabled', () => {
	const {manager, tunnels} = makeManager();
	manager.start();
	tunnels[0].emit('url', 'https://x.trycloudflare.com');
	manager.dispose();
	assert.equal(tunnels[0].stopped, 1);
	assert.equal(manager.getStatus().state, 'disabled');
});

test('活跃 Edge 为远程引擎 → start 直接拒绝 failed(remote)，不走 spawn', () => {
	const {manager, tunnels} = makeManager({isLocalEdge: () => false});
	const s = manager.start();
	assert.equal(s.state, 'failed');
	assert.equal(s.code, 'remote');
	assert.equal(tunnels.length, 0);
});

test('origin 预检通过 → ready', async () => {
	const {manager, tunnels} = makeManager({originProbe: async () => true});
	manager.start();
	tunnels[0].emit('url', 'https://abc.trycloudflare.com');
	await sleep(5);
	const s = manager.getStatus();
	assert.equal(s.state, 'ready');
	assert.equal(s.url, 'https://abc.trycloudflare.com/bridge');
});

test('origin 预检失败 → failed(origin) 且停隧道', async () => {
	const {manager, tunnels} = makeManager({originProbe: async () => false});
	manager.start();
	tunnels[0].emit('url', 'https://abc.trycloudflare.com');
	await sleep(5);
	const s = manager.getStatus();
	assert.equal(s.state, 'failed');
	assert.equal(s.code, 'origin');
	assert.equal(tunnels[0].stopped, 1);
});

test('公共 URL 归一化：补齐 /bridge 路径', () => {
	const {manager, tunnels} = makeManager();
	manager.start();
	tunnels[0].emit('url', 'https://x.trycloudflare.com/');
	const s = manager.getStatus();
	assert.equal(s.state, 'ready');
	assert.equal(s.url, 'https://x.trycloudflare.com/bridge');
});

test('ready 后的瞬态 error 不致失败（exit 才处理崩溃）', () => {
	const {manager, tunnels} = makeManager();
	manager.start();
	tunnels[0].emit('url', 'https://y.trycloudflare.com');
	assert.equal(manager.getStatus().state, 'ready');
	tunnels[0].emit('error', new Error('connection reset by peer'));
	assert.equal(manager.getStatus().state, 'ready');
});

test('origin 预检抛异常 → failed(origin)', async () => {
	const {manager, tunnels} = makeManager({
		originProbe: async () => {
			throw new Error('conn refused');
		},
	});
	manager.start();
	tunnels[0].emit('url', 'https://abc.trycloudflare.com');
	await sleep(5);
	const s = manager.getStatus();
	assert.equal(s.state, 'failed');
	assert.equal(s.code, 'origin');
});