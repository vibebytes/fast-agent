import {Tunnel, use} from 'cloudflared';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import type {CloudflareTunnelFailureCode, CloudflareTunnelStatus} from '@fast-ide/session-view';

export type {CloudflareTunnelFailureCode, CloudflareTunnelStatus};

/** cloudflared 上报根域名，引擎路由固定在 GET /bridge，公共 URL 统一补齐该路径。 */
function publicBridgeUrl(raw: string): string {
	const base = raw.replace(/\/+$/, '');
	return base.endsWith('/bridge') ? base : `${base}/bridge`;
}

export type CloudflareTunnelHandle = {
	on(event: 'url', listener: (url: string) => void): unknown;
	on(event: 'error', listener: (err: Error) => void): unknown;
	on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	stop(): boolean;
};

export type CloudflareTunnelManagerDeps = {
	originUrl: string;
	getServerKey: () => string;
	createTunnel?: (originUrl: string) => CloudflareTunnelHandle;
	/** 当前活跃 Edge 是否为本机引擎；false 时 start 直接拒绝（v1 仅支持本机）。 */
	isLocalEdge?: () => boolean;
	/** origin 预检：对 http://127.0.0.1:<port>/bridge 发 HTTP 探测（任意响应码即可）。 */
	originProbe?: () => Promise<boolean>;
	urlTimeoutMs?: number;
	crashBackoffMs?: number;
	maxCrashRestarts?: number;
	stopGraceMs?: number;
	onStatus?: (s: CloudflareTunnelStatus) => void;
};

/** Packaged app ships the cloudflared binary in Resources/bin; the bundled default path no longer works. */
function packagedCloudflaredBin(): string | null {
	const resources = process.resourcesPath;
	if (!resources) return null;
	const bin = join(resources, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
	return existsSync(bin) ? bin : null;
}

const defaultCreateTunnel = (originUrl: string): CloudflareTunnelHandle => {
	const bin = packagedCloudflaredBin();
	if (bin) use(bin);
	return Tunnel.quick(originUrl);
};

export class CloudflareTunnelManager {
	private status: CloudflareTunnelStatus = {state: 'disabled'};
	private generation = 0;
	private tunnel: CloudflareTunnelHandle | null = null;
	private urlTimer: NodeJS.Timeout | null = null;
	private stopTimer: NodeJS.Timeout | null = null;
	private restartTimer: NodeJS.Timeout | null = null;
	private crashCount = 0;

	constructor(private readonly deps: CloudflareTunnelManagerDeps) {}

	getStatus(): CloudflareTunnelStatus {
		return this.status;
	}

	/** 单飞：starting/ready/stopping 时直接返回当前状态，不重复拉起。 */
	start(): CloudflareTunnelStatus {
		const s = this.status;
		if (s.state === 'starting' || s.state === 'ready' || s.state === 'stopping') return s;
		if (this.deps.isLocalEdge && !this.deps.isLocalEdge()) {
			this.fail('remote', 'Cloudflare 隧道当前仅支持本机引擎');
			return this.status;
		}
		this.crashCount = 0;
		this.generation += 1;
		this.setStatus({state: 'starting', since: Date.now(), generation: this.generation});
		this.spawn();
		return this.status;
	}

	/** 幂等：disabled/stopping 时直接返回。 */
	stop(): CloudflareTunnelStatus {
		const s = this.status;
		if (s.state === 'disabled' || s.state === 'stopping') return s;
		this.clearUrlTimer();
		this.clearRestartTimer();
		this.setStatus({state: 'stopping'});
		const t = this.tunnel;
		this.tunnel = null;
		if (t) t.stop();
		this.stopTimer = setTimeout(() => {
			if (this.status.state === 'stopping') this.setStatus({state: 'disabled'});
		}, this.deps.stopGraceMs ?? 2_000);
		return this.status;
	}

	/** app 退出兜底：停掉 cloudflared、清定时器，防残留进程。 */
	dispose(): void {
		this.clearUrlTimer();
		this.clearRestartTimer();
		this.clearStopTimer();
		const t = this.tunnel;
		this.tunnel = null;
		if (t) t.stop();
		this.setStatus({state: 'disabled'});
	}

	private spawn(): void {
		let tunnel: CloudflareTunnelHandle;
		try {
			tunnel = (this.deps.createTunnel ?? defaultCreateTunnel)(this.deps.originUrl);
		} catch (err) {
			this.fail('spawn', err instanceof Error ? err.message : String(err));
			return;
		}
		this.tunnel = tunnel;
		this.urlTimer = setTimeout(() => {
			if (this.status.state !== 'starting') return;
			this.fail('timeout', '边缘握手超时，未在限时内拿到公共 URL');
			this.stopTunnel();
		}, this.deps.urlTimeoutMs ?? 10_000);
		tunnel.on('url', (raw) => {
			if (this.status.state !== 'starting') return;
			this.clearUrlTimer();
			this.generation += 1;
			this.crashCount = 0;
			const url = publicBridgeUrl(raw);
			if (this.deps.originProbe) {
				this.setStatus({state: 'starting', since: Date.now(), generation: this.generation});
				this.probeOriginThenReady(url);
			} else {
				this.setStatus({
					state: 'ready',
					url,
					serverKey: this.deps.getServerKey(),
					generation: this.generation,
					startedAt: Date.now(),
				});
			}
		});
		tunnel.on('error', (err) => {
			// ready 后多为边缘瞬态断连（进程仍存活），真实崩溃由 exit 事件自愈
			if (this.status.state !== 'starting') return;
			const code = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'download' : 'spawn';
			this.fail(code, err.message);
			this.stopTunnel();
		});
		tunnel.on('exit', (code, signal) => {
			this.tunnel = null;
			this.clearUrlTimer();
			if (this.status.state === 'stopping') {
				this.clearStopTimer();
				this.setStatus({state: 'disabled'});
				return;
			}
			if (this.status.state === 'failed') return;
			this.crashCount += 1;
			if (this.crashCount > (this.deps.maxCrashRestarts ?? 3)) {
				this.fail('crash', `cloudflared 反复退出（${this.crashCount} 次），已停止自愈`);
				return;
			}
			this.generation += 1;
			this.setStatus({state: 'starting', since: Date.now(), generation: this.generation});
			this.restartTimer = setTimeout(() => this.spawn(), this.deps.crashBackoffMs ?? 2_000);
		});
	}

	private stopTunnel(): void {
		const t = this.tunnel;
		this.tunnel = null;
		if (t) t.stop();
	}

	/** ready ≠ URL 解析成功：先对 origin 发 HTTP 探测（任意响应码），不通 → failed('origin')。 */
	private async probeOriginThenReady(url: string): Promise<void> {
		const probe = this.deps.originProbe;
		if (probe) {
			let ok = false;
			try {
				ok = await probe();
			} catch {
				ok = false;
			}
			if (!ok) {
				this.fail('origin', '引擎未开启 loopback 配对口');
				this.stopTunnel();
				return;
			}
		}
		if (this.status.state !== 'starting') return;
		this.setStatus({
			state: 'ready',
			url,
			serverKey: this.deps.getServerKey(),
			generation: this.generation,
			startedAt: Date.now(),
		});
	}

	private fail(code: CloudflareTunnelFailureCode, message?: string): void {
		this.generation += 1;
		this.setStatus({state: 'failed', code, message, generation: this.generation});
	}

	private setStatus(s: CloudflareTunnelStatus): void {
		this.status = s;
		this.deps.onStatus?.(s);
	}

	private clearUrlTimer(): void {
		if (this.urlTimer) {
			clearTimeout(this.urlTimer);
			this.urlTimer = null;
		}
	}

	private clearStopTimer(): void {
		if (this.stopTimer) {
			clearTimeout(this.stopTimer);
			this.stopTimer = null;
		}
	}

	private clearRestartTimer(): void {
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = null;
		}
	}
}