import {useEffect, useSyncExternalStore} from 'react';
import type {McpControlResult, McpServerOp, McpServerRow} from '@fastllm/bridge-client';

export type McpStatus = 'loading' | 'ready' | 'error' | 'disabled';

export type McpNoticeKind = 'NeedsRestart' | 'Busy' | 'InvalidJson' | 'Denied' | 'EngineDown' | 'Unknown';

export type McpView = {
	status: McpStatus;
	servers: McpServerRow[];
	search: string;
	notice: string | null;
	noticeKind: McpNoticeKind | null;
	busy: Record<string, boolean>;
	engineReady: boolean;
};

type McpApi = {
	listMcpServers: () => Promise<{ok: true; mcpServers: McpServerRow[]} | {ok: false; notice: string}>;
	mcpServerControl: (
		name: string,
		op: McpServerOp
	) => Promise<{ok: true; mcp: McpControlResult} | {ok: false; notice: string}>;
	mcpServerPut: (name: string, config: unknown) => Promise<{ok: true; mcpServers: McpServerRow[]} | {ok: false; notice: string}>;
	mcpServerEnabled: (
		name: string,
		enabled: boolean
	) => Promise<{ok: true; mcpServers: McpServerRow[]} | {ok: false; notice: string}>;
	mcpServerDelete: (name: string) => Promise<{ok: true} | {ok: false; notice: string}>;
	mcpConfigImport: (payload: unknown) => Promise<{ok: true; mcpServers: McpServerRow[]} | {ok: false; notice: string}>;
	mcpConfigReload: () => Promise<{ok: true; mcpServers: McpServerRow[]} | {ok: false; notice: string}>;
};

export function mcpNoticeKind(notice: string): McpNoticeKind {
	if (/restart required|needs restart|需重启/i.test(notice)) return 'NeedsRestart';
	if (/\bBusy\b/i.test(notice)) return 'Busy';
	if (/invalid|json|no servers|bad request|must be/i.test(notice)) return 'InvalidJson';
	if (/denied|forbidden/i.test(notice)) return 'Denied';
	if (/not ready|engine down|admin not ready/i.test(notice)) return 'EngineDown';
	return 'Unknown';
}

function viewOf(
	status: McpStatus,
	servers: McpServerRow[],
	search: string,
	notice: string | null,
	busy: Record<string, boolean>,
	engineReady = false
): McpView {
	return {status, servers, search, notice, noticeKind: notice ? mcpNoticeKind(notice) : null, busy, engineReady};
}

function sorted(rows: McpServerRow[]): McpServerRow[] {
	return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

const IMPORT_WRAPPER_KEYS = ['mcpServers', 'servers', 'mcp', 'mcp_servers'] as const;

export type ParsedImport = {ok: true; payload: {mcpServers: Record<string, unknown>}; count: number} | {ok: false; error: string};

const SERVER_CONFIG_KEYS = new Set(['command', 'args', 'env', 'url', 'transport', 'type', 'headers', 'cwd', 'enabled']);

function looksLikeServerConfig(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	return Object.keys(value as object).some(k => SERVER_CONFIG_KEYS.has(k));
}

const IMPORT_SERVER_KEYS = new Set([
	'enabled',
	'type',
	'transport',
	'url',
	'command',
	'args',
	'env',
	'cwd',
	'sandbox',
	'description',
	'timeout',
	'startupTimeout',
	'allowedTools',
	'blockedTools'
]);

/** Keeps engine-known fields, maps Cline-style `disabled`/string `args`, drops ecosystem-only junk (headers, autoApprove, ...). */
function normalizeImportedServer(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const src = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(src)) {
		if (IMPORT_SERVER_KEYS.has(k) && v !== null) out[k] = v;
	}
	if (typeof src.disabled === 'boolean') out.enabled = !src.disabled;
	if (typeof out.args === 'string') out.args = (out.args as string).split(/\s+/).filter(Boolean);
	return Object.keys(out).length > 0 ? out : null;
}

function normalizeServerMap(input: Record<string, unknown>): {payload: {mcpServers: Record<string, unknown>}; count: number} | null {
	const servers: Record<string, unknown> = {};
	for (const [name, cfg] of Object.entries(input)) {
		const norm = normalizeImportedServer(cfg);
		if (norm) servers[name] = norm;
	}
	const count = Object.keys(servers).length;
	return count === 0 ? null : {payload: {mcpServers: servers}, count};
}

/** Accepts fastllm / claude_desktop / plain server-map JSON and normalizes to {mcpServers}. */
export function parseImportPayload(text: string): ParsedImport {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		return {ok: false, error: e instanceof Error ? e.message : String(e)};
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {ok: false, error: 'not a JSON object'};
	const obj = raw as Record<string, unknown>;
	for (const key of IMPORT_WRAPPER_KEYS) {
		const inner = obj[key];
		if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
			const norm = normalizeServerMap(inner as Record<string, unknown>);
			if (norm) return {ok: true, ...norm};
		}
	}
	const values = Object.values(obj);
	if (values.length > 0 && values.every(looksLikeServerConfig)) {
		const norm = normalizeServerMap(obj);
		if (norm) return {ok: true, ...norm};
	}
	return {ok: false, error: 'no servers found'};
}

function liveApi(): McpApi {
	return {
		listMcpServers: () => window.fastIde.listMcpServers(),
		mcpServerControl: (name, op) => window.fastIde.mcpServerControl(name, op),
		mcpServerPut: (name, config) => window.fastIde.mcpServerPut(name, config),
		mcpServerEnabled: (name, enabled) => window.fastIde.mcpServerEnabled(name, enabled),
		mcpServerDelete: name => window.fastIde.mcpServerDelete(name),
		mcpConfigImport: payload => window.fastIde.mcpConfigImport(payload),
		mcpConfigReload: () => window.fastIde.mcpConfigReload()
	};
}

function errText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

class McpStore {
	private view: McpView = viewOf('loading', [], '', null, {}, false);
	private listeners = new Set<() => void>();
	private generation = 0;
	private startingTimer: ReturnType<typeof setTimeout> | null = null;
	private listing: Promise<void> | null = null;
	private listAgain = false;
	private api: McpApi = liveApi();

	bindApi(api: McpApi): void {
		this.api = api;
	}

	resetForTest(): void {
		this.generation += 1;
		this.listing = null;
		this.listAgain = false;
		this.clearStartingRefresh();
		this.view = viewOf('loading', [], '', null, {});
		this.publish();
	}

	getSnapshot = (): McpView => this.view;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	private publish(): void {
		for (const listener of this.listeners) listener();
	}

	private setView(next: McpView): void {
		this.view = next;
		this.publish();
	}

	private patch(partial: Partial<McpView>): void {
		this.setView({...this.view, ...partial});
	}

	private withBusy(key: string, busy: boolean): void {
		const next = {...this.view.busy};
		if (busy) next[key] = true;
		else delete next[key];
		this.patch({busy: next});
	}

	setEngineReady(ready: boolean): void {
		if (!ready) {
			if (!this.view.engineReady && this.view.status === 'disabled') return;
			this.setView(viewOf('disabled', this.view.servers, this.view.search, null, {}, false));
			return;
		}
		if (this.view.engineReady) return;
		void this.list(true);
	}

	list = async (engineReady = false): Promise<void> => {
		if (this.listing) {
			this.listAgain = true;
			return this.listing;
		}
		const refresh = this.view.status === 'ready' && this.view.servers.length > 0;
		const gen = refresh ? this.generation : ++this.generation;
		if (engineReady || this.view.engineReady) {
			if (!engineReady && !this.view.engineReady) {
				this.setView(viewOf('disabled', this.view.servers, this.view.search, null, {}, false));
				return;
			}
			if (!refresh) this.patch({status: 'loading', engineReady: true});
			else this.patch({engineReady: true});
		} else {
			this.setView(viewOf('disabled', this.view.servers, this.view.search, null, {}, false));
			return;
		}
		this.listing = (async () => {
			try {
				const res = await this.api.listMcpServers();
				if (gen !== this.generation) return;
				if (!res.ok) {
					this.patch({status: 'error', notice: res.notice});
					return;
				}
				this.setView(viewOf('ready', sorted(res.mcpServers), this.view.search, null, this.view.busy, true));
			} catch (e) {
				if (gen !== this.generation) return;
				this.patch({status: 'error', notice: errText(e)});
			} finally {
				this.listing = null;
				if (this.listAgain) {
					this.listAgain = false;
					void this.list();
				} else {
					this.scheduleStartingRefresh();
				}
			}
		})();
		return this.listing;
	};

	retry = (): void => {
		void this.list();
	};

	setSearch(search: string): void {
		this.patch({search});
	}

	dismissNotice(): void {
		this.patch({notice: null});
	}

	private clearStartingRefresh(): void {
		if (this.startingTimer == null) return;
		clearTimeout(this.startingTimer);
		this.startingTimer = null;
	}

	/** Handshake can take longer than the first list; keep pulling while any row is `starting`. */
	private scheduleStartingRefresh(): void {
		this.clearStartingRefresh();
		if (!this.view.servers.some(r => (r.state ?? '').toLowerCase() === 'starting')) return;
		this.startingTimer = setTimeout(() => {
			this.startingTimer = null;
			void this.list();
		}, 1500);
	}

	private applyRows(rows: McpServerRow[] | undefined, notice: string | null = null): void {
		this.setView(
			viewOf('ready', sorted(rows ?? this.view.servers), this.view.search, notice, this.view.busy, this.view.engineReady)
		);
	}

	/** Write cmds may ack without rows (legacy WriteResult in `mcp`). Re-list instead of wiping. */
	private async applyWrite(rows: McpServerRow[], notice: string | null = null): Promise<void> {
		if (rows.length > 0) {
			this.applyRows(rows, notice);
			return;
		}
		await this.list();
		if (notice) this.patch({notice, noticeKind: mcpNoticeKind(notice)});
	}

	control = async (name: string, op: McpServerOp): Promise<boolean> => {
		if (this.view.busy[name]) return false;
		this.withBusy(name, true);
		try {
			const res = await this.api.mcpServerControl(name, op);
			await this.list();
			if (!res.ok) {
				this.patch({notice: res.notice, noticeKind: mcpNoticeKind(res.notice)});
				return false;
			}
			const err = res.mcp.lastError?.trim();
			if (err) this.patch({notice: err, noticeKind: mcpNoticeKind(err)});
			else if (res.mcp.restartRequired) this.patch({notice: 'restart required', noticeKind: 'NeedsRestart'});
			return true;
		} catch (e) {
			this.applyRows(undefined, errText(e));
			return false;
		} finally {
			this.withBusy(name, false);
		}
	};

	save = async (name: string, config: unknown): Promise<boolean> => {
		if (this.view.busy[name]) return false;
		this.withBusy(name, true);
		try {
			const res = await this.api.mcpServerPut(name, config);
			if (!res.ok) {
				this.applyRows(undefined, res.notice);
				return false;
			}
			await this.applyWrite(res.mcpServers);
			return true;
		} catch (e) {
			this.applyRows(undefined, errText(e));
			return false;
		} finally {
			this.withBusy(name, false);
		}
	};

	toggle = async (name: string, enabled: boolean): Promise<boolean> => {
		const prev = this.view.servers.find(row => row.name === name);
		const revert = (notice: string): void => {
			const restored = prev?.enabled ?? enabled;
			this.setView({
				...this.view,
				servers: sorted(this.view.servers.map(row => (row.name === name ? {...row, enabled: restored} : row))),
				notice,
				noticeKind: mcpNoticeKind(notice)
			});
		};
		this.setView({
			...this.view,
			servers: sorted(this.view.servers.map(row => (row.name === name ? {...row, enabled} : row)))
		});
		try {
			const res = await this.api.mcpServerEnabled(name, enabled);
			if (!res.ok) {
				revert(res.notice);
				return false;
			}
			const restart = res.mcpServers.find(row => row.name === name)?.restartRequired;
			await this.applyWrite(res.mcpServers, restart ? 'restart required' : null);
			return true;
		} catch (e) {
			revert(errText(e));
			return false;
		}
	};

	remove = async (name: string): Promise<boolean> => {
		this.withBusy(name, true);
		try {
			const res = await this.api.mcpServerDelete(name);
			if (!res.ok) {
				this.applyRows(undefined, res.notice);
				return false;
			}
			this.applyRows(this.view.servers.filter(row => row.name !== name));
			await this.list();
			return true;
		} catch (e) {
			this.applyRows(undefined, errText(e));
			return false;
		} finally {
			this.withBusy(name, false);
		}
	};

	importServers = async (payload: unknown): Promise<boolean> => {
		if (this.view.busy.import) return false;
		this.withBusy('import', true);
		try {
			const res = await this.api.mcpConfigImport(payload);
			if (!res.ok) {
				this.applyRows(undefined, res.notice);
				return false;
			}
			await this.applyWrite(res.mcpServers);
			return true;
		} catch (e) {
			this.applyRows(undefined, errText(e));
			return false;
		} finally {
			this.withBusy('import', false);
		}
	};

	reload = async (): Promise<boolean> => {
		if (this.view.busy.reload) return false;
		this.withBusy('reload', true);
		try {
			const res = await this.api.mcpConfigReload();
			if (!res.ok) {
				this.applyRows(undefined, res.notice);
				return false;
			}
			await this.applyWrite(res.mcpServers);
			return true;
		} catch (e) {
			this.applyRows(undefined, errText(e));
			return false;
		} finally {
			this.withBusy('reload', false);
		}
	};
}

export const mcpStore = new McpStore();

/** Settings-center MCP servers — Plugins P3. */
export function useMcpServers(engineReady: boolean): McpView & {
	retry: () => void;
	list: () => Promise<void>;
	setSearch: (q: string) => void;
	dismissNotice: () => void;
	control: (name: string, op: McpServerOp) => Promise<boolean>;
	save: (name: string, config: unknown) => Promise<boolean>;
	toggle: (name: string, enabled: boolean) => Promise<boolean>;
	remove: (name: string) => Promise<boolean>;
	importServers: (payload: unknown) => Promise<boolean>;
	reload: () => Promise<boolean>;
} {
	useEffect(() => {
		mcpStore.setEngineReady(engineReady);
	}, [engineReady]);

	const view = useSyncExternalStore(mcpStore.subscribe, mcpStore.getSnapshot, mcpStore.getSnapshot);
	const shown = engineReady ? view : {...view, status: 'disabled' as const};

	return {
		...shown,
		retry: mcpStore.retry,
		list: mcpStore.list,
		setSearch: mcpStore.setSearch,
		dismissNotice: mcpStore.dismissNotice,
		control: mcpStore.control,
		save: mcpStore.save,
		toggle: mcpStore.toggle,
		remove: mcpStore.remove,
		importServers: mcpStore.importServers,
		reload: mcpStore.reload
	};
}

export type McpHook = ReturnType<typeof useMcpServers>;
