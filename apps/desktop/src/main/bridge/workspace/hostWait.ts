import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';

export type CommandResult = Extract<BridgeEvent, {type: 'command_result'}>;

export type WaitHandle = {
	token: string;
	promise: Promise<CommandResult>;
};

export type HostLane = {
	ready: () => boolean;
	send: (cmd: BridgeCommand) => boolean;
	wait: (
		names: string[],
		metaId?: string,
		timeoutMs?: number,
		checkoutId?: string
	) => WaitHandle;
	waitRequest: (requestId: string, timeoutMs?: number) => WaitHandle;
	cancel: (token: string) => void;
	metaId: (projectId: string) => string | undefined;
	displayName: (metaId?: string | null) => string | undefined;
};

/**
 * `command_result` names answered to a host caller rather than to an attached session.
 *
 * These replies are sent with `stampSession = false`, so they carry no sessionId and the session demux
 * would otherwise hand them to whichever Task is focused. A name missing from here does not fail
 * loudly — its caller just waits out its timeout — so anything added to the invoke surface belongs
 * here too.
 */
export const HostWaitCommands = new Set([
	'GetSettings',
	'GetBridgePairing',
	'SetLanPairing',
	'PatchSettings',
	'ListProviders',
	'UpsertProvider',
	'DeleteProvider',
	'SetProviderEnabled',
	'TestProvider',
	'PatchProviderModels',
	'SearchProviderModels',
	'ListSkills',
	'CreateSkill',
	'DeleteSkill',
	'SetSkillEnabled',
	'SearchSkillMarket',
	'InstallSkillFromMarket',
	'UninstallSkillFromMarket',
	'ListExtensions',
	'ExtensionStatus',
	'InstallExtension',
	'UninstallExtension',
	'ListEngines',
	'EnableEngine',
	'DisableEngine',
	'StartEngine',
	'StopEngine',
	'SetDefaultEngine',
	'InstallEngine',
	'UninstallEngine',
	'CancelEngineInstall',
	'ListHostDir',
	'CreateHostDir',
	'ListRules',
	'AddRule',
	'RemoveRule',
	'SetRuleEnabled',
	'ListScheduledJobs',
	'CreateScheduledJob',
	'ListLivingTasks',
	'ListScheduledJobRuns',
	'PauseScheduledJob',
	'ResumeScheduledJob',
	'CancelScheduledJob',
	'FireNowScheduledJob',
	'UpdateScheduledJobCron',
	'ListTeams',
	'ListGoals',
	'ListAgents',
	'CreateTeam',
	'UpdateTeam',
	'ArchiveTeam',
	'UnarchiveTeam',
	'GetTeam',
	'CreateAgent',
	'UpdateAgent',
	'ArchiveAgent',
	'UnarchiveAgent',
	'CloneAgent',
	'GetAgent',
	'DeleteTeam',
	'SaveAsTeam',
	'PromoteTeam',
	'DeleteAgent',
	'StopAgentRun',
	'DeleteGoal',
	'ListReviewChanges',
	'GetReviewChange',
	'KeepChanges',
	'PreviewRevert',
	'ApplyRevert',
	'RedoRevert',
	'ListWorkspaceDir',
	'GetWorkspaceFile',
	'SaveWorkspaceFile',
	'GitWorkspaceStatus',
	'DshCall'
]);

type NameWaiter = {
	names: Set<string>;
	projectId?: string;
	checkoutProjectId?: string;
	resolve: (event: CommandResult) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

type RequestWaiter = {
	requestId: string;
	resolve: (event: CommandResult) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

export type HostWait = {
	wait: HostLane['wait'];
	waitRequest: HostLane['waitRequest'];
	cancel: (token: string) => void;
	resolveByName: (event: CommandResult, checkoutProjectId?: string) => void;
	resolveByRequestId: (event: CommandResult) => void;
};

export function createHostWait(opts: {requestWaitMs: number; defaultTimeoutMs?: number}): HostWait {
	const defaultTimeoutMs = opts.defaultTimeoutMs ?? 12_000;
	const byName = new Map<string, NameWaiter>();
	const byRequest = new Map<string, RequestWaiter>();
	let seq = 0;

	return {
		wait(names, projectId, timeoutMs = defaultTimeoutMs, checkoutProjectId) {
			const token = `rule-wait-${++seq}`;
			const promise = new Promise<CommandResult>((resolve, reject) => {
				byName.set(token, {
					names: new Set(names),
					projectId,
					checkoutProjectId,
					resolve,
					reject,
					timer: setTimeout(() => {
						byName.delete(token);
						reject(new Error(`timeout waiting for ${names.join('/')}`));
					}, timeoutMs)
				});
			});
			return {token, promise};
		},
		waitRequest(requestId, timeoutMs = opts.requestWaitMs) {
			const token = `req-wait-${++seq}`;
			const promise = new Promise<CommandResult>((resolve, reject) => {
				byRequest.set(token, {
					requestId,
					resolve,
					reject,
					timer: setTimeout(() => {
						byRequest.delete(token);
						reject(new Error(`timeout waiting for requestId ${requestId}`));
					}, timeoutMs)
				});
			});
			return {token, promise};
		},
		cancel(token) {
			const rule = byName.get(token);
			if (rule) {
				byName.delete(token);
				clearTimeout(rule.timer);
				rule.reject(new Error('send failed'));
				return;
			}
			const req = byRequest.get(token);
			if (!req) return;
			byRequest.delete(token);
			clearTimeout(req.timer);
			req.reject(new Error('send failed'));
		},
		resolveByName(event, checkoutProjectId) {
			const eventProjectId =
				'projectId' in event && typeof event.projectId === 'string' ? event.projectId : undefined;
			for (const [token, entry] of byName) {
				if (!entry.names.has(event.name)) continue;
				if (entry.projectId && eventProjectId && entry.projectId !== eventProjectId) continue;
				if (entry.checkoutProjectId && checkoutProjectId && entry.checkoutProjectId !== checkoutProjectId) {
					continue;
				}
				byName.delete(token);
				clearTimeout(entry.timer);
				entry.resolve(event);
				return;
			}
		},
		resolveByRequestId(event) {
			const requestId = event.requestId;
			if (!requestId) return;
			for (const [token, entry] of byRequest) {
				if (entry.requestId !== requestId) continue;
				byRequest.delete(token);
				clearTimeout(entry.timer);
				entry.resolve(event);
				return;
			}
		}
	};
}

export async function hostRequest(
	lane: HostLane,
	names: string[],
	cmd: BridgeCommand,
	opts?: {metaId?: string; timeoutMs?: number; checkoutId?: string}
): Promise<{ok: true; event: CommandResult} | {ok: false; notice: string}> {
	if (!lane.ready()) return {ok: false, notice: 'Engine not ready'};
	const {token, promise} = lane.wait(names, opts?.metaId, opts?.timeoutMs, opts?.checkoutId);
	if (!lane.send(cmd)) {
		lane.cancel(token);
		return {ok: false, notice: `Failed to send ${names[0]}`};
	}
	try {
		return {ok: true, event: await promise};
	} catch (e) {
		return {ok: false, notice: e instanceof Error ? e.message : String(e)};
	}
}

export function noticeOf(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
