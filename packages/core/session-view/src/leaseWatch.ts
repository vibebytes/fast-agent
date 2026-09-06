import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {RUN_LEASE_INTERVAL_MS, RUN_LEASE_TTL_MS} from './composerGate.js';
import type {TranscriptState} from './transcriptProjection.js';
import {chromeAwaitingSettlement, chromeRunId} from './runChrome.js';

export const LEASE_TERMINALS = new Set([
	'turn_finished',
	'turn_cancelled',
	'run_done',
	'run_failed',
	'run_cancelled',
	'run_exhausted'
]);

export const isLeaseRenewal = (eventType: BridgeEvent['type']): boolean =>
	eventType === 'run_state' || LEASE_TERMINALS.has(eventType);

export const hasLocalRun = (t: TranscriptState): boolean =>
	Boolean(chromeRunId(t.chrome)) || t.entries.some(e => e.status === 'streaming');

export type LeaseTimers = {
	now: () => number;
	setTimeout: (fn: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
	setInterval: (fn: () => void, ms: number) => unknown;
	clearInterval: (handle: unknown) => void;
};

const nodeTimers: LeaseTimers = {
	now: () => Date.now(),
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
	setInterval: (fn, ms) => {
		const timer = setInterval(fn, ms) as {unref?: () => void};
		timer.unref?.();
		return timer;
	},
	clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>)
};

export type LeaseWatchTask = {id: string; transcript: TranscriptState};

export type LeaseWatchHandle = {
	armCancelSettle(taskId: string): void;
	clearCancelSettle(taskId: string): void;
	clearAllCancelSettle(): void;
	syncCancelSettle(task: LeaseWatchTask): void;
	noteRunLease(task: LeaseWatchTask, event: BridgeEvent): void;
	ensureLeaseScan(): void;
	stopLeaseScan(): void;
	tickRunLeases(): void;
	clearLeaseBookkeeping(): void;
	forgetTask(taskId: string): void;
	dispose(): void;
	readonly pendingCancelSettleCount: number;
	readonly leaseScanArmed: boolean;
};

export type LeaseWatchDeps<T extends LeaseWatchTask> = {
	now: () => number;
	scanIntervalMs: number;
	cancelSettleTimeoutMs: number;
	timers?: LeaseTimers;
	tasks: () => Iterable<T>;
	busy: (task: T) => boolean;
	sessionIdOf: (task: T) => string | null;
	onReconcile: (task: T) => void;
	onExpire: (task: T) => void;
	cancelSettleDue: (taskId: string) => void;
	onChange?: () => void;
};

/**
 * Run-lease watchdog + cancel-settlement timers for the bridge host.
 * Tables (leaseSeenAt/leaseReconcileAt/cancelSettleTimers) and the scan
 * interval live here; expiry itself stays with the host via onExpire.
 */
export function createLeaseWatch<T extends LeaseWatchTask>(deps: LeaseWatchDeps<T>): LeaseWatchHandle {
	const timers = deps.timers ?? nodeTimers;
	const leaseSeenAt = new Map<string, number>();
	const leaseReconcileAt = new Map<string, number>();
	const cancelSettleTimers = new Map<string, unknown>();
	let leaseScanTimer: unknown = null;

	const armCancelSettle = (taskId: string): void => {
		clearCancelSettle(taskId);
		cancelSettleTimers.set(
			taskId,
			timers.setTimeout(() => {
				cancelSettleTimers.delete(taskId);
				deps.cancelSettleDue(taskId);
			}, deps.cancelSettleTimeoutMs)
		);
	};

	const clearCancelSettle = (taskId: string): void => {
		const timer = cancelSettleTimers.get(taskId);
		if (timer != null) {
			timers.clearTimeout(timer);
			cancelSettleTimers.delete(taskId);
		}
	};

	const clearAllCancelSettle = (): void => {
		for (const timer of cancelSettleTimers.values()) timers.clearTimeout(timer);
		cancelSettleTimers.clear();
	};

	const syncCancelSettle = (task: LeaseWatchTask): void => {
		if (chromeAwaitingSettlement(task.transcript.chrome)) {
			if (!cancelSettleTimers.has(task.id)) armCancelSettle(task.id);
		} else {
			clearCancelSettle(task.id);
		}
	};

	const ensureLeaseScan = (): void => {
		if (leaseScanTimer != null || deps.scanIntervalMs <= 0) return;
		leaseScanTimer = timers.setInterval(() => tickRunLeases(), deps.scanIntervalMs);
	};

	const stopLeaseScan = (): void => {
		if (leaseScanTimer == null) return;
		timers.clearInterval(leaseScanTimer);
		leaseScanTimer = null;
	};

	const noteRunLease = (task: LeaseWatchTask, event: BridgeEvent): void => {
		if (!isLeaseRenewal(event.type)) return;
		leaseSeenAt.set(task.id, deps.now());
		leaseReconcileAt.delete(task.id);
		if (task.transcript.leaseAware) ensureLeaseScan();
	};

	/** Host-owned TTL: attach reconcile, then local settle if the snapshot stays silent. */
	const tickRunLeases = (): void => {
		const now = deps.now();
		let changed = false;
		for (const task of [...deps.tasks()]) {
			if (!task.transcript.leaseAware || !deps.busy(task)) {
				leaseReconcileAt.delete(task.id);
				continue;
			}
			const reconcileAt = leaseReconcileAt.get(task.id);
			if (reconcileAt != null) {
				if (now - reconcileAt < RUN_LEASE_INTERVAL_MS) continue;
				deps.onExpire(task);
				leaseReconcileAt.delete(task.id);
				changed = true;
				continue;
			}
			const seen = leaseSeenAt.get(task.id);
			if (seen == null || now - seen <= RUN_LEASE_TTL_MS) continue;
			if (deps.sessionIdOf(task)) deps.onReconcile(task);
			leaseReconcileAt.set(task.id, now);
		}
		if (changed) deps.onChange?.();
	};

	const clearLeaseBookkeeping = (): void => {
		leaseSeenAt.clear();
		leaseReconcileAt.clear();
	};

	const forgetTask = (taskId: string): void => {
		clearCancelSettle(taskId);
		leaseSeenAt.delete(taskId);
		leaseReconcileAt.delete(taskId);
	};

	const dispose = (): void => {
		stopLeaseScan();
		clearAllCancelSettle();
		clearLeaseBookkeeping();
	};

	return {
		armCancelSettle,
		clearCancelSettle,
		clearAllCancelSettle,
		syncCancelSettle,
		noteRunLease,
		ensureLeaseScan,
		stopLeaseScan,
		tickRunLeases,
		clearLeaseBookkeeping,
		forgetTask,
		dispose,
		get pendingCancelSettleCount() {
			return cancelSettleTimers.size;
		},
		get leaseScanArmed() {
			return leaseScanTimer != null;
		}
	};
}
