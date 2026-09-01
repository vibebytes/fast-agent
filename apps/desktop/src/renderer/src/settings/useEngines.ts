import {useEffect, useSyncExternalStore} from 'react';
import type {EngineRow, EngAdminApi} from '@fastllm/bridge-client';

export type EngStatus = 'loading' | 'ready' | 'error' | 'disabled';

export type EngsView = {
	status: EngStatus;
	engines: EngineRow[];
	notice: string | null;
	engineReady: boolean;
};

function viewOf(
	engines: EngineRow[],
	status: EngStatus,
	notice: string | null,
	engineReady: boolean
): EngsView {
	return {status, engines, notice, engineReady};
}

function liveApi(): EngAdminApi {
	return {
		listEngines: () => window.fastIde.listEngines(),
		enableEngine: id => window.fastIde.enableEngine(id),
		disableEngine: id => window.fastIde.disableEngine(id),
		startEngine: id => window.fastIde.startEngine(id),
		stopEngine: id => window.fastIde.stopEngine(id),
		setDefaultEngine: id => window.fastIde.setDefaultEngine(id),
		installEngine: id => window.fastIde.installEngine(id),
		uninstallEngine: id => window.fastIde.uninstallEngine(id),
		cancelEngineInstall: id => window.fastIde.cancelEngineInstall(id),
		onEngineInstallLog: handler => window.fastIde.onEngineInstallLog(handler)
	};
}

export function engNoticeKind(notice: string): 'Busy' | 'Denied' | 'EngineDown' | 'RemoteUrl' | 'Idle' | 'Unknown' {
	if (/\bBusy\b/.test(notice)) return 'Busy';
	if (notice === 'denied') return 'Denied';
	if (/engine not ready/i.test(notice)) return 'EngineDown';
	if (notice === 'remote url forbidden') return 'RemoteUrl';
	if (notice === 'Idle') return 'Idle';
	return 'Unknown';
}

function mergeRows(current: EngineRow[], patch: EngineRow[]): EngineRow[] {
	const byId = new Map(current.map(r => [r.id, r]));
	for (const row of patch) {
		const prev = byId.get(row.id);
		const next = {...prev, ...row};
		if ((!row.installLog || row.installLog.length === 0) && prev?.installLog?.length) {
			next.installLog = prev.installLog;
		}
		byId.set(row.id, next);
	}
	return current.some(r => patch.some(p => p.id === r.id))
		? current.map(r => byId.get(r.id) ?? r)
		: [...current, ...patch.filter(p => !byId.has(p.id))];
}

class EngsStore {
	private view: EngsView = viewOf([], 'loading', null, false);
	private listeners = new Set<() => void>();
	private api: EngAdminApi = liveApi();
	private unsubLog: (() => void) | null = null;
	private subscribedStatus = false;

	bindApi(api: EngAdminApi): void {
		this.api = api;
	}

	resetForTest(): void {
		this.unsubLog?.();
		this.unsubLog = null;
		this.subscribedStatus = false;
		this.view = viewOf([], 'loading', null, false);
		this.publish();
	}

	getSnapshot = (): EngsView => this.view;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	private publish(): void {
		for (const listener of this.listeners) listener();
	}

	private setView(next: EngsView): void {
		this.view = next;
		this.publish();
	}

	setEngineReady(ready: boolean): void {
		if (!ready) {
			this.unsubLog?.();
			this.unsubLog = null;
			this.setView({...this.view, engineReady: false, status: 'disabled', notice: null});
			return;
		}
		if (this.view.engineReady) return;
		this.setView({...this.view, engineReady: true});
		this.listenLogs();
		void this.list();
	}

	private listenLogs(): void {
		if (this.unsubLog || !this.api.onEngineInstallLog) return;
		this.unsubLog = this.api.onEngineInstallLog(log => {
			const next = this.view.engines.map(row => {
				if (row.id !== log.engineId) return row;
				const installLog = [...(row.installLog ?? []), log].slice(-200);
				const program = row.program === 'missing' ? 'installing' : row.program;
				const actions = program === 'installing' ? ['cancel'] : row.actions;
				return {...row, installLog, program, actions};
			});
			this.setView({...this.view, engines: next});
		});
	}

	list = async (): Promise<void> => {
		if (!this.view.engineReady) {
			this.setView({...this.view, status: 'disabled', notice: null});
			return;
		}
		this.setView({...this.view, status: 'loading'});
		try {
			const res = await this.api.listEngines();
			if (!res.ok) {
				this.setView(viewOf(this.view.engines, 'error', res.notice, true));
				return;
			}
			this.setView(viewOf(res.engines, 'ready', null, true));
		} catch (e) {
			this.setView(
				viewOf(this.view.engines, 'error', e instanceof Error ? e.message : String(e), true)
			);
		}
	};

	private write = async (
		op: (id: string) => Promise<{ok: true; engines: EngineRow[]} | {ok: false; notice: string}>,
		id: string,
		optimistic?: (engines: EngineRow[]) => EngineRow[]
	): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return false;
		const snapshot = this.view.engines;
		if (optimistic) {
			this.setView({...this.view, engines: optimistic(this.view.engines), notice: null});
		}
		const res = await op(id);
		if (!res.ok) {
			this.setView({
				...this.view,
				engines: this.view.engines.map(row => {
					if (row.id !== id) return row;
					if (row.program === 'missing' || row.program === 'installed') return row;
					const prev = snapshot.find(r => r.id === id);
					return prev ? {...row, program: prev.program, actions: prev.actions} : row;
				}),
				notice: res.notice,
				status: 'ready'
			});
			return false;
		}
		this.setView({
			...this.view,
			engines: mergeRows(this.view.engines, res.engines),
			notice: null,
			status: 'ready'
		});
		return true;
	};

	enable = (id: string) => this.write(this.api.enableEngine, id);
	disable = (id: string) => this.write(this.api.disableEngine, id);
	start = (id: string) => this.write(this.api.startEngine, id);
	stop = (id: string) => this.write(this.api.stopEngine, id);
	setDefault = (id: string) => this.write(this.api.setDefaultEngine, id);
	install = (id: string) =>
		this.write(this.api.installEngine, id, engines =>
			engines.map(row =>
				row.id === id ? {...row, program: 'installing', actions: ['cancel']} : row
			)
		);
	uninstall = (id: string) => this.write(this.api.uninstallEngine, id);
	cancelInstall = (id: string) => this.write(this.api.cancelEngineInstall, id);
}

export const engStore = new EngsStore();

export function useEngines(engineReady: boolean): EngsView & {
	list: () => Promise<void>;
	enable: (id: string) => Promise<boolean>;
	disable: (id: string) => Promise<boolean>;
	start: (id: string) => Promise<boolean>;
	stop: (id: string) => Promise<boolean>;
	setDefault: (id: string) => Promise<boolean>;
	install: (id: string) => Promise<boolean>;
	uninstall: (id: string) => Promise<boolean>;
	cancelInstall: (id: string) => Promise<boolean>;
} {
	useEffect(() => {
		engStore.setEngineReady(engineReady);
	}, [engineReady]);

	const view = useSyncExternalStore(engStore.subscribe, engStore.getSnapshot, engStore.getSnapshot);
	const shown = engineReady ? view : {...view, status: 'disabled' as const, engineReady: false};

	return {
		...shown,
		list: engStore.list,
		enable: engStore.enable,
		disable: engStore.disable,
		start: engStore.start,
		stop: engStore.stop,
		setDefault: engStore.setDefault,
		install: engStore.install,
		uninstall: engStore.uninstall,
		cancelInstall: engStore.cancelInstall
	};
}
