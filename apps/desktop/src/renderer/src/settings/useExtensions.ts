import {useEffect, useSyncExternalStore} from 'react';
import type {ExtNote, ExtPhase, ExtRow} from '@fastllm/bridge-client';

export type ExtStatus = 'loading' | 'ready' | 'error' | 'disabled';

export type ExtFailed = {id: string; dir: string | null};

export type ExtsView = {
	status: ExtStatus;
	extensions: ExtRow[];
	ledger: ExtNote[];
	notice: string | null;
	engineReady: boolean;
	failed: ExtFailed | null;
};

export type ExtNoticeKind =
	| 'NeedsRestart'
	| 'Busy'
	| 'DescFault'
	| 'RemoteUrl'
	| 'Denied'
	| 'EngineDown'
	| 'Unknown';

type ExtApi = {
	listExtensions: () => Promise<
		{ok: true; extensions: ExtRow[]; ledger: ExtNote[]} | {ok: false; notice: string}
	>;
	extensionStatus: (
		id: string
	) => Promise<{ok: true; extension: ExtRow | null} | {ok: false; notice: string}>;
	installExtension: (dir: string) => Promise<{ok: true; id: string} | {ok: false; notice: string}>;
	uninstallExtension: (id: string) => Promise<{ok: true} | {ok: false; notice: string}>;
	pickExtensionDir: () => Promise<string | null>;
};

function viewOf(
	extensions: ExtRow[],
	ledger: ExtNote[],
	status: ExtStatus,
	notice: string | null,
	engineReady: boolean,
	failed: ExtFailed | null
): ExtsView {
	return {status, extensions, ledger, notice, engineReady, failed};
}

function liveApi(): ExtApi {
	return {
		listExtensions: () => window.fastIde.listExtensions(),
		extensionStatus: id => window.fastIde.extensionStatus(id),
		installExtension: dir => window.fastIde.installExtension(dir),
		uninstallExtension: id => window.fastIde.uninstallExtension(id),
		pickExtensionDir: () => window.fastIde.pickExtensionDir()
	};
}

export function noticeKind(notice: string): ExtNoticeKind {
	if (notice === '需重启') return 'NeedsRestart';
	if (/\bBusy\b/.test(notice)) return 'Busy';
	if (/DescFault|InvalidYaml|BadId|MissingFile|UnknownPoint|BadMode|BadPrefix|\bVersion\b/.test(notice)) {
		return 'DescFault';
	}
	if (notice === 'remote url forbidden') return 'RemoteUrl';
	if (notice === 'denied') return 'Denied';
	if (/engine not ready/i.test(notice)) return 'EngineDown';
	return 'Unknown';
}

function rowsOf(raw: ExtRow[]): ExtRow[] {
	return raw.map(row => ({
		...row,
		restartHint: row.hotUnload ? undefined : '需重启'
	}));
}

function dirId(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function isLive(row: ExtRow | undefined): boolean {
	return Boolean(row && row.phase !== 'Failed' && row.phase !== 'Uninstalled');
}

function overlayFailed(rows: ExtRow[], failed: ExtFailed | null, fault: string | null): ExtRow[] {
	if (!failed) return rows;
	const next = rows.map(row =>
		row.id === failed.id ? {...row, phase: 'Failed' as ExtPhase, fault: fault ?? row.fault} : row
	);
	if (next.some(row => row.id === failed.id)) return next;
	return [
		...next,
		{
			id: failed.id,
			phase: 'Failed',
			hotUnload: true,
			fault: fault ?? undefined,
			restartHint: undefined
		}
	];
}

class ExtsStore {
	private view: ExtsView = viewOf([], [], 'loading', null, false, null);
	private listeners = new Set<() => void>();
	private inflight: Promise<void> | null = null;
	private generation = 0;
	private api: ExtApi = liveApi();

	bindApi(api: ExtApi): void {
		this.api = api;
	}

	resetForTest(): void {
		this.generation += 1;
		this.inflight = null;
		this.view = viewOf([], [], 'loading', null, false, null);
		this.publish();
	}

	getSnapshot = (): ExtsView => this.view;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	private publish(): void {
		for (const listener of this.listeners) listener();
	}

	private setView(next: ExtsView): void {
		this.view = next;
		this.publish();
	}

	setEngineReady(ready: boolean): void {
		if (!ready) {
			if (this.view.status === 'disabled' && !this.view.engineReady) return;
			this.setView({
				...this.view,
				engineReady: false,
				status: 'disabled',
				notice: null,
				failed: null
			});
			return;
		}
		if (this.view.engineReady) return;
		this.setView({...this.view, engineReady: true});
		void this.list();
	}

	list = async (): Promise<void> => {
		if (!this.view.engineReady) {
			this.setView({...this.view, status: 'disabled', notice: null});
			return;
		}
		const gen = ++this.generation;
		const keepNotice = this.view.failed ? this.view.notice : null;
		this.setView({...this.view, status: 'loading', notice: keepNotice});
		const run = this.api
			.listExtensions()
			.then(res => {
				if (gen !== this.generation) return;
				if (!res.ok) {
					this.setView(
						viewOf(
							this.view.extensions,
							this.view.ledger,
							'error',
							res.notice,
							true,
							this.view.failed
						)
					);
					return;
				}
				const rows = overlayFailed(rowsOf(res.extensions), this.view.failed, keepNotice);
				this.setView(viewOf(rows, res.ledger, 'ready', keepNotice, true, this.view.failed));
			})
			.catch(e => {
				if (gen !== this.generation) return;
				this.setView(
					viewOf(
						this.view.extensions,
						this.view.ledger,
						'error',
						e instanceof Error ? e.message : String(e),
						true,
						this.view.failed
					)
				);
			});
		this.inflight = run.finally(() => {
			if (this.inflight === run) this.inflight = null;
		});
		await this.inflight;
	};

	retry = (): void => {
		void this.list();
	};

	statusOf = async (id: string): Promise<ExtRow | null> => {
		const local = this.view.extensions.find(row => row.id === id) ?? null;
		if (!this.view.engineReady) return local;
		try {
			const res = await this.api.extensionStatus(id);
			if (!res.ok || !res.extension) return local;
			const row = rowsOf([res.extension])[0]!;
			const patched = overlayFailed(
				this.view.extensions.some(r => r.id === id)
					? this.view.extensions.map(r => (r.id === id ? row : r))
					: [...this.view.extensions, row],
				this.view.failed,
				this.view.failed ? this.view.notice : null
			);
			this.setView({...this.view, extensions: patched});
			return patched.find(r => r.id === id) ?? row;
		} catch {
			return local;
		}
	};

	install = async (dir?: string): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return false;
		const prev = this.view;
		const path = dir ?? (await this.api.pickExtensionDir());
		if (!path) return false;
		const res = await this.api.installExtension(path);
		if (!res.ok) {
			const id = dirId(path);
			const keepLive = isLive(prev.extensions.find(r => r.id === id));
			const nextFailed = keepLive ? prev.failed : {id, dir: path};
			this.setView({
				...prev,
				notice: res.notice,
				status: 'ready',
				failed: nextFailed,
				extensions: keepLive ? prev.extensions : overlayFailed(prev.extensions, nextFailed, res.notice)
			});
			return false;
		}
		this.setView({...prev, failed: null, notice: null});
		await this.list();
		return true;
	};

	uninstall = async (id: string): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return false;
		const prev = this.view;
		const res = await this.api.uninstallExtension(id);
		if (!res.ok) {
			this.setView({...prev, notice: res.notice, status: 'ready'});
			return false;
		}
		this.setView({...prev, failed: prev.failed?.id === id ? null : prev.failed, notice: null});
		await this.list();
		return true;
	};

	upgrade = async (id: string): Promise<boolean> => {
		if (!this.view.engineReady || this.view.status === 'disabled') return false;
		const prev = this.view;
		const gone = await this.api.uninstallExtension(id);
		if (!gone.ok) {
			this.setView({...prev, notice: gone.notice, status: 'ready'});
			return false;
		}
		const dir = await this.api.pickExtensionDir();
		if (!dir) {
			this.setView({...prev, failed: null, notice: null});
			await this.list();
			return false;
		}
		const inst = await this.api.installExtension(dir);
		if (!inst.ok) {
			const failed = {id, dir};
			this.setView({
				...prev,
				notice: inst.notice,
				status: 'ready',
				failed,
				extensions: overlayFailed(prev.extensions, failed, inst.notice)
			});
			await this.list();
			return false;
		}
		this.setView({...prev, failed: null, notice: null});
		await this.list();
		return true;
	};

	reinstall = async (id: string): Promise<boolean> => {
		const dir = this.view.failed?.id === id ? this.view.failed.dir : null;
		return this.install(dir ?? undefined);
	};
}

export const extStore = new ExtsStore();

/** Settings-center extensions — Plugins P1/P2. */
export function useExtensions(engineReady: boolean): ExtsView & {
	retry: () => void;
	list: () => Promise<void>;
	statusOf: (id: string) => Promise<ExtRow | null>;
	install: (dir?: string) => Promise<boolean>;
	uninstall: (id: string) => Promise<boolean>;
	upgrade: (id: string) => Promise<boolean>;
	reinstall: (id: string) => Promise<boolean>;
} {
	useEffect(() => {
		extStore.setEngineReady(engineReady);
	}, [engineReady]);

	const view = useSyncExternalStore(extStore.subscribe, extStore.getSnapshot, extStore.getSnapshot);
	const shown = engineReady ? view : {...view, status: 'disabled' as const, engineReady: false};

	return {
		...shown,
		retry: extStore.retry,
		list: extStore.list,
		statusOf: extStore.statusOf,
		install: extStore.install,
		uninstall: extStore.uninstall,
		upgrade: extStore.upgrade,
		reinstall: extStore.reinstall
	};
}
