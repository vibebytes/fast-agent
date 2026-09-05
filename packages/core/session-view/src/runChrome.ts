/**
 * Run chrome lifecycle (CONTEXT.md → RunChrome).
 *
 * One state machine for stop chrome: idle → active → cancelPending →
 * settled, with `sealedRun` for the rare state where the run id stays
 * pinned after sealing (goal notice un-marking a cancel, late run settles
 * that keep another run's card alive).
 *
 * `runChromeTransition` is the single normalizer: every writer describes
 * intent as a step and the invariant (awaiting ⇒ cancelPending, postRun ⇔
 * sealedRun/settled) holds by construction. Predicates replace the old
 * four parallel flags: awaitingCancelSettlement ⇔ cancelPending,
 * postRunTerminal ⇔ sealedRun | settled, activeRunId ⇔ chromeRunId.
 */

export type RunChrome =
	| {phase: 'idle'}
	| {phase: 'active'; runId: string; fromServer: boolean}
	| {phase: 'cancelPending'; runId?: string; fromServer: boolean}
	| {phase: 'sealedRun'; runId: string; fromServer: boolean}
	| {phase: 'settled'};

export const IDLE_RUN_CHROME: RunChrome = {phase: 'idle'};

export const SETTLED_RUN_CHROME: RunChrome = {phase: 'settled'};

export function chromeRunId(chrome: RunChrome | undefined): string | undefined {
	switch (chrome?.phase) {
		case 'active':
		case 'sealedRun':
			return chrome.runId;
		case 'cancelPending':
			return chrome.runId;
		default:
			return undefined;
	}
}

export function chromeFromServer(chrome: RunChrome | undefined): boolean {
	return chrome?.phase === 'active' || chrome?.phase === 'cancelPending' || chrome?.phase === 'sealedRun'
		? chrome.fromServer
		: false;
}

export function chromePostRun(chrome: RunChrome | undefined): boolean {
	return chrome?.phase !== 'active' && chrome?.phase !== 'idle';
}

export function chromeAwaitingSettlement(chrome: RunChrome | undefined): boolean {
	return chrome?.phase === 'cancelPending';
}

/** Does the Stop button have a target to cancel. */
export function chromeStopLit(chrome: RunChrome | undefined): boolean {
	return chrome?.phase === 'active' || chrome?.phase === 'cancelPending';
}

export type RunChromeStep = {
	/** keep the pinned run id, clear it, or pin a new one (fromServer defaults to true). */
	run?: 'keep' | 'clear' | {id: string; fromServer?: boolean};
	/** 'keep' carries the previous postRun verdict. */
	postRun?: boolean | 'keep';
	/** 'keep' carries the previous awaiting verdict. */
	awaiting?: boolean | 'keep' | 'clear';
};

export function runChromeTransition(prev: RunChrome, step: RunChromeStep): RunChrome {
	const run = step.run ?? 'keep';
	const runId = run === 'clear' ? undefined : run === 'keep' ? chromeRunId(prev) : run.id;
	const fromServer =
		run === 'clear' ? false : run === 'keep' ? chromeFromServer(prev) : (run.fromServer ?? true);
	const awaiting =
		step.awaiting === undefined || step.awaiting === 'keep'
			? chromeAwaitingSettlement(prev)
			: step.awaiting === 'clear'
				? false
				: step.awaiting;
	const postRun =
		step.postRun === undefined || step.postRun === 'keep' ? chromePostRun(prev) : step.postRun;

	if (awaiting) {
		return runId ? {phase: 'cancelPending', runId, fromServer} : {phase: 'cancelPending', fromServer};
	}
	if (!postRun) {
		return runId ? {phase: 'active', runId, fromServer} : IDLE_RUN_CHROME;
	}
	return runId ? {phase: 'sealedRun', runId, fromServer} : SETTLED_RUN_CHROME;
}
