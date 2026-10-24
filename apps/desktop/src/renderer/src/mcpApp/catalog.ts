import type {McpAppRow, McpErr, McpOk} from '@fastllm/bridge-client';
import {appKey} from './store';

export type McpAppListResult = McpOk<{apps: McpAppRow[]}> | McpErr;

export type McpAppCatalogState = {
	/** `idle` until the first answer: a rail sweep must not run on a list nobody fetched. */
	status: 'idle' | 'loading' | 'ready' | 'error';
	apps: McpAppRow[];
	notice: string | null;
	/** True once any list has landed; a later failure keeps the last good `apps`. */
	ready: boolean;
};

export type McpAppCatalog = {
	get(): McpAppCatalogState;
	subscribe(fn: (state: McpAppCatalogState) => void): () => void;
	/** `force` bypasses the in-flight join — used when the server list changed under us. */
	load(opts?: {force?: boolean}): Promise<void>;
	/** `null` until a list has landed at least once, so a transient failure never closes tabs. */
	liveKeys(): Set<string> | null;
};

const IDLE: McpAppCatalogState = {status: 'idle', apps: [], notice: null, ready: false};

/** `null` until a list has landed at least once, so a transient failure never closes tabs. */
export function liveKeysOf(state: McpAppCatalogState): Set<string> | null {
	if (!state.ready) return null;
	return new Set(state.apps.map(app => appKey(app.server, app.resourceUri)));
}

function sameApps(a: readonly McpAppRow[], b: readonly McpAppRow[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		const x = a[i]!;
		const y = b[i]!;
		if (x.server !== y.server || x.resourceUri !== y.resourceUri || x.tool !== y.tool) return false;
	}
	return true;
}

export function createMcpAppCatalog(fetchApps: () => Promise<McpAppListResult>): McpAppCatalog {
	let state = IDLE;
	let everReady = false;
	let pending: Promise<void> | null = null;
	let generation = 0;
	const listeners = new Set<(state: McpAppCatalogState) => void>();

	function publish(next: McpAppCatalogState): void {
		if (next === state) return;
		state = next;
		for (const fn of listeners) fn(state);
	}

	function load(opts?: {force?: boolean}): Promise<void> {
		if (pending && !opts?.force) return pending;
		const gen = generation + 1;
		generation = gen;
		if (!everReady) publish({...state, status: 'loading', notice: null});
		const run = (async () => {
			let res: McpAppListResult;
			try {
				res = await fetchApps();
			} catch (err) {
				res = {ok: false, notice: err instanceof Error ? err.message : String(err)};
			}
			if (gen !== generation) return;
			if (res.ok) {
				everReady = true;
				publish({
					status: 'ready',
					apps: sameApps(state.apps, res.apps) ? state.apps : res.apps,
					notice: null,
					ready: true
				});
				return;
			}
			publish({status: 'error', apps: state.apps, notice: res.notice, ready: everReady});
		})().finally(() => {
			if (gen === generation) pending = null;
		});
		pending = run;
		return run;
	}

	return {
		get: () => state,
		subscribe(fn) {
			listeners.add(fn);
			return () => {
				listeners.delete(fn);
			};
		},
		load,
		liveKeys() {
			return liveKeysOf(state);
		}
	};
}

export const mcpAppCatalog = createMcpAppCatalog(async () => window.fastIde.mcpAppList());
