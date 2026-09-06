import {randomUUID} from 'node:crypto';
import type {
	AmbientRule,
	GetWorkspaceFileResult,
	GitStatus,
	HostDirCreateResult,
	HostDirResult,
	ListWorkspaceDirResult,
	SaveWorkspaceFileResult,
	WorkspaceFsCode
} from '@fast-ide/session-view';
import {CONNECT_DEADLINE_MS} from '../../remoteEdges.js';
import {isReservedDefaultFolder} from '../remotePaths.js';
import {hostRequest, type CommandResult, type HostLane} from './hostWait.js';

const GIT_FRESH_TTL_MS = 3_000;
const GIT_NOT_GIT_TTL_MS = 5 * 60_000;

const WorkspaceFsCodes = new Set<string>([
	'outside',
	'too-large',
	'binary',
	'conflict',
	'missing',
	'no-slot',
	'busy',
	'is-dir',
	'not-found',
	'not-dir',
	'denied',
	'invalid',
	'exists'
]);

export function asFsCode(raw: unknown): WorkspaceFsCode | undefined {
	return typeof raw === 'string' && WorkspaceFsCodes.has(raw) ? (raw as WorkspaceFsCode) : undefined;
}

export type CheckoutLane = HostLane & {
	activeWorkspaceId: () => string;
	rememberSave: (pathHash: string, relativePath: string, mtime: number) => void;
	isRemote: () => boolean;
	pendingEdge: () => boolean;
	hostHome: () => string | undefined;
	setHostHome: (home: string) => void;
	requestWaitMs: () => number;
};

export type WorkspaceCheckout = {
	listWorkspaceDir: (relativePath?: string) => Promise<ListWorkspaceDirResult>;
	getWorkspaceFile: (relativePath: string) => Promise<GetWorkspaceFileResult>;
	saveWorkspaceFile: (
		relativePath: string,
		content: string,
		mtime?: number,
		bytes?: number
	) => Promise<SaveWorkspaceFileResult>;
	gitWorkspaceStatus: (force?: boolean) => Promise<GitStatus | null>;
	listHostDir: (dirPath?: string) => Promise<HostDirResult>;
	createHostDir: (parent: string, name: string) => Promise<HostDirCreateResult>;
	listRules: (
		projectId: string
	) => Promise<{ok: true; rules: AmbientRule[]; replace: true} | {ok: false; notice: string}>;
	addProjectRule: (
		projectId: string,
		text: string
	) => Promise<{ok: true; rules: AmbientRule[]; replace: boolean} | {ok: false; notice: string}>;
	removeRule: (projectId: string, ruleId: string) => Promise<{ok: true} | {ok: false; notice: string}>;
	setRuleEnabled: (
		projectId: string,
		ruleId: string,
		enabled: boolean
	) => Promise<{ok: true} | {ok: false; notice: string}>;
};

function rulesFromEvent(event: CommandResult): AmbientRule[] {
	const raw = (event as {rules?: AmbientRule[]}).rules;
	return Array.isArray(raw) ? raw : [];
}

export function createCheckout(lane: CheckoutLane): WorkspaceCheckout {
	const gitNotUntil = new Map<string, number>();
	const gitFresh = new Map<string, {at: number; snapshot: GitStatus | null}>();
	const gitInFlight = new Map<string, Promise<GitStatus | null>>();
	const gitGen = new Map<string, number>();
	let ruleOpTail: Promise<void> = Promise.resolve();

	const runRuleOp = <T>(fn: () => Promise<T>): Promise<T> => {
		const run = ruleOpTail.then(fn, fn);
		ruleOpTail = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	};

	const workspaceIdOr = <T>(onErr: (msg: string) => T): {ok: true; id: string} | {ok: false; err: T} => {
		try {
			return {ok: true, id: lane.activeWorkspaceId()};
		} catch (e) {
			return {ok: false, err: onErr(e instanceof Error ? e.message : String(e))};
		}
	};

	const gitCacheWrite = (key: string, gen: number, snapshot: GitStatus | null, notGit: boolean) => {
		if (gitGen.get(key) !== gen) return;
		if (notGit) gitNotUntil.set(key, Date.now() + GIT_NOT_GIT_TTL_MS);
		else gitNotUntil.delete(key);
		gitFresh.set(key, {at: Date.now(), snapshot});
	};

	const gitSoftKeep = (key: string, gen: number): GitStatus | null => {
		const keep = gitFresh.get(key)?.snapshot ?? null;
		gitCacheWrite(key, gen, keep, false);
		return keep;
	};

	const probeGit = async (workspaceId: string, key: string, gen: number): Promise<GitStatus | null> => {
		const requestId = randomUUID();
		const {token, promise} = lane.waitRequest(requestId);
		if (!lane.send({type: 'GitWorkspaceStatus', requestId, workspaceId})) {
			lane.cancel(token);
			return gitSoftKeep(key, gen);
		}
		try {
			const event = await promise;
			const fsCode = asFsCode(event.fs?.code);
			if (event.status === 'error' || event.status === 'rejected' || fsCode === 'no-slot') {
				return gitSoftKeep(key, gen);
			}
			const git = (
				event as {
					git?: {
						available?: boolean;
						branch?: string;
						dirty?: boolean;
						files?: Array<{path: string; kind: 'modified' | 'added' | 'deleted'}>;
					};
				}
			).git;
			if (git?.available === false) {
				gitCacheWrite(key, gen, null, true);
				return null;
			}
			if (!git) return gitSoftKeep(key, gen);
			const branch = git.branch?.trim() ?? '';
			if (!branch) return gitSoftKeep(key, gen);
			const files = Array.isArray(git.files) ? git.files : [];
			const snapshot: GitStatus = {branch, dirty: git.dirty === true || files.length > 0, files};
			gitCacheWrite(key, gen, snapshot, false);
			return snapshot;
		} catch {
			return gitSoftKeep(key, gen);
		}
	};

	return {
		async listWorkspaceDir(relativePath) {
			const ws = workspaceIdOr(msg => ({ok: false as const, error: msg, entries: [] as []}));
			if (!ws.ok) return ws.err;
			if (!lane.ready()) return {ok: false, error: 'Engine not ready', entries: []};
			const requestId = randomUUID();
			const {token, promise} = lane.waitRequest(requestId);
			if (
				!lane.send({
					type: 'ListWorkspaceDir',
					requestId,
					workspaceId: ws.id,
					...(relativePath != null && relativePath !== '' ? {relativePath} : {})
				})
			) {
				lane.cancel(token);
				return {ok: false, error: 'Failed to send ListWorkspaceDir', entries: []};
			}
			try {
				const event = await promise;
				const fs = event.fs;
				const code = asFsCode(fs?.code);
				if (event.status === 'error' || event.status === 'rejected' || code) {
					return {ok: false, error: event.message || code || 'ListWorkspaceDir failed', code, entries: []};
				}
				const entries = Array.isArray(fs?.entries)
					? fs.entries.map(e => ({
							name: e.name,
							kind: e.kind,
							relativePath: e.relativePath ?? e.path ?? '',
							...(e.mtime != null ? {mtime: e.mtime} : {})
						}))
					: [];
				return {
					ok: true,
					relativePath: fs?.relativePath ?? relativePath ?? '',
					entries,
					...(fs?.truncated === true ? {truncated: true} : {})
				};
			} catch (e) {
				return {ok: false, error: e instanceof Error ? e.message : String(e), entries: []};
			}
		},
		async getWorkspaceFile(relativePath) {
			const ws = workspaceIdOr(msg => ({ok: false as const, error: msg}));
			if (!ws.ok) return ws.err;
			if (!lane.ready()) return {ok: false, error: 'Engine not ready'};
			const requestId = randomUUID();
			const {token, promise} = lane.waitRequest(requestId);
			if (!lane.send({type: 'GetWorkspaceFile', requestId, workspaceId: ws.id, relativePath})) {
				lane.cancel(token);
				return {ok: false, error: 'Failed to send GetWorkspaceFile'};
			}
			try {
				const event = await promise;
				const fs = event.fs;
				const code = asFsCode(fs?.code);
				if (event.status === 'error' || event.status === 'rejected' || code) {
					return {ok: false, error: event.message || code || 'GetWorkspaceFile failed', code};
				}
				if (typeof fs?.content !== 'string' || typeof fs.mtime !== 'number') {
					return {ok: false, error: 'GetWorkspaceFile missing content/mtime'};
				}
				return {
					ok: true,
					relativePath: fs.relativePath ?? relativePath,
					content: fs.content,
					mtime: fs.mtime,
					...(typeof fs.bytes === 'number' ? {bytes: fs.bytes} : {})
				};
			} catch (e) {
				return {ok: false, error: e instanceof Error ? e.message : String(e)};
			}
		},
		async saveWorkspaceFile(relativePath, content, mtime, bytes) {
			const ws = workspaceIdOr(msg => ({ok: false as const, error: msg}));
			if (!ws.ok) return ws.err;
			if (!lane.ready()) return {ok: false, error: 'Engine not ready'};
			const requestId = randomUUID();
			const {token, promise} = lane.waitRequest(requestId);
			if (
				!lane.send({
					type: 'SaveWorkspaceFile',
					requestId,
					workspaceId: ws.id,
					relativePath,
					content,
					...(mtime != null ? {mtime} : {}),
					...(bytes != null ? {bytes} : {})
				})
			) {
				lane.cancel(token);
				return {ok: false, error: 'Failed to send SaveWorkspaceFile'};
			}
			try {
				const event = await promise;
				const fs = event.fs;
				const code = asFsCode(fs?.code);
				if (event.status === 'error' || event.status === 'rejected' || code) {
					return {
						ok: false,
						error: event.message || code || 'SaveWorkspaceFile failed',
						code,
						...(typeof fs?.mtime === 'number' ? {mtime: fs.mtime} : {})
					};
				}
				if (typeof fs?.mtime !== 'number' || typeof fs.bytes !== 'number') {
					return {ok: false, error: 'SaveWorkspaceFile missing mtime/bytes'};
				}
				lane.rememberSave(event.pathHash ?? ws.id, fs.relativePath ?? relativePath, fs.mtime);
				return {ok: true, relativePath: fs.relativePath ?? relativePath, mtime: fs.mtime, bytes: fs.bytes};
			} catch (e) {
				return {ok: false, error: e instanceof Error ? e.message : String(e)};
			}
		},
		async gitWorkspaceStatus(force) {
			const ws = workspaceIdOr(() => null);
			if (!ws.ok) return ws.err;
			if (!lane.ready()) return null;
			const key = ws.id;
			if (!force) {
				const until = gitNotUntil.get(key);
				if (until !== undefined && Date.now() < until) return null;
				const hit = gitFresh.get(key);
				if (hit && Date.now() - hit.at < GIT_FRESH_TTL_MS) return hit.snapshot;
				const pending = gitInFlight.get(key);
				if (pending) return pending;
			} else {
				gitNotUntil.delete(key);
				const hit = gitFresh.get(key);
				if (hit) gitFresh.set(key, {at: 0, snapshot: hit.snapshot});
			}
			const gen = (gitGen.get(key) ?? 0) + 1;
			gitGen.set(key, gen);
			const probe = probeGit(ws.id, key, gen);
			gitInFlight.set(key, probe);
			try {
				return await probe;
			} finally {
				if (gitInFlight.get(key) === probe) gitInFlight.delete(key);
			}
		},
		async listHostDir(dirPath) {
			if (!lane.isRemote()) {
				return {ok: false, error: 'host:listDir is only available on a remote edge', code: 'denied', entries: []};
			}
			if (lane.pendingEdge()) {
				return {ok: false, error: 'Edge switch in progress', code: 'denied', entries: []};
			}
			if (!lane.ready()) return {ok: false, error: 'Engine not ready', code: 'denied', entries: []};
			const requestId = randomUUID();
			const {token, promise} = lane.waitRequest(requestId, Math.min(lane.requestWaitMs(), CONNECT_DEADLINE_MS));
			if (!lane.send({type: 'ListHostDir', requestId, ...(dirPath?.trim() ? {path: dirPath.trim()} : {})})) {
				lane.cancel(token);
				return {ok: false, error: 'Failed to send ListHostDir', entries: []};
			}
			try {
				const event = await promise;
				const message = event.message ?? '';
				if (/unknown command/i.test(message)) {
					return {
						ok: false,
						error: message,
						code: 'unknown-command',
						fallback: true,
						home: lane.hostHome(),
						entries: []
					};
				}
				const fs = event.fs;
				const code = asFsCode(fs?.code);
				if (event.status === 'error' || event.status === 'rejected' || code) {
					const mapped =
						code === 'not-found' || code === 'not-dir' || code === 'denied' || code === 'invalid'
							? code
							: undefined;
					return {
						ok: false,
						error: message || code || 'ListHostDir failed',
						code: mapped,
						home: typeof fs?.home === 'string' ? fs.home : lane.hostHome(),
						entries: []
					};
				}
				const home = typeof fs?.home === 'string' ? fs.home : (lane.hostHome() ?? '');
				const listed = typeof fs?.path === 'string' ? fs.path : (dirPath?.trim() || home);
				const entries = Array.isArray(fs?.entries)
					? fs.entries
							.filter(e => e.kind === 'dir' && !isReservedDefaultFolder(e.path ?? e.name))
							.map(e => ({name: e.name, path: e.path ?? e.relativePath ?? e.name, kind: 'dir' as const}))
					: [];
				if (home && !lane.hostHome()) lane.setHostHome(home);
				return {ok: true, path: listed, home, entries, truncated: fs?.truncated};
			} catch (error) {
				return {
					ok: false,
					error: error instanceof Error ? error.message : String(error),
					code: 'timeout',
					home: lane.hostHome(),
					entries: []
				};
			}
		},
		async createHostDir(parent, name) {
			if (!lane.isRemote()) {
				return {ok: false, error: 'host:createDir is only available on a remote edge', code: 'denied'};
			}
			if (lane.pendingEdge()) {
				return {ok: false, error: 'Edge switch in progress', code: 'denied'};
			}
			if (!lane.ready()) return {ok: false, error: 'Engine not ready', code: 'denied'};
			const folder = parent.trim();
			const segment = name.trim();
			if (!folder || !segment) return {ok: false, error: 'invalid', code: 'invalid'};
			const requestId = randomUUID();
			const {token, promise} = lane.waitRequest(requestId, Math.min(lane.requestWaitMs(), CONNECT_DEADLINE_MS));
			if (!lane.send({type: 'CreateHostDir', requestId, parent: folder, name: segment})) {
				lane.cancel(token);
				return {ok: false, error: 'Failed to send create directory'};
			}
			try {
				const event = await promise;
				const message = event.message ?? '';
				if (/unknown command/i.test(message)) {
					return {ok: false, error: message, code: 'unknown-command', fallback: true, home: lane.hostHome()};
				}
				const fs = event.fs;
				const code = asFsCode(fs?.code);
				if (event.status === 'error' || event.status === 'rejected' || code) {
					const mapped =
						code === 'not-found' ||
						code === 'not-dir' ||
						code === 'denied' ||
						code === 'invalid' ||
						code === 'exists'
							? code
							: undefined;
					return {
						ok: false,
						error: message || code || 'create directory failed',
						code: mapped,
						home: typeof fs?.home === 'string' ? fs.home : lane.hostHome()
					};
				}
				const created =
					typeof fs?.path === 'string' && fs.path.trim()
						? fs.path
						: `${folder.replace(/[/\\]+$/, '')}/${segment}`;
				const home = typeof fs?.home === 'string' ? fs.home : (lane.hostHome() ?? '');
				if (home && !lane.hostHome()) lane.setHostHome(home);
				return {ok: true, path: created, home, name: typeof fs?.name === 'string' ? fs.name : segment};
			} catch (error) {
				return {
					ok: false,
					error: error instanceof Error ? error.message : String(error),
					code: 'timeout',
					home: lane.hostHome()
				};
			}
		},
		listRules: projectId =>
			runRuleOp(async () => {
				const metaId = lane.metaId(projectId);
				if (!metaId) return {ok: false as const, notice: 'Project not ready — wait for Engine Meta'};
				const r = await hostRequest(lane, ['ListRules'], {type: 'ListRules', projectId: metaId}, {metaId});
				if (!r.ok) return r;
				if (r.event.status === 'error') return {ok: false as const, notice: r.event.message};
				return {ok: true as const, rules: rulesFromEvent(r.event), replace: true as const};
			}),
		addProjectRule: (projectId, text) =>
			runRuleOp(async () => {
				const metaId = lane.metaId(projectId);
				const trimmed = text.trim();
				if (!trimmed) return {ok: false as const, notice: 'text required'};
				if (!metaId) return {ok: false as const, notice: 'Project not ready — wait for Engine Meta'};
				const r = await hostRequest(
					lane,
					['AddRule'],
					{type: 'AddRule', scope: 'project', projectId: metaId, text: trimmed},
					{metaId}
				);
				if (!r.ok) return r;
				if (r.event.status === 'error') return {ok: false as const, notice: r.event.message};
				const added = rulesFromEvent(r.event);
				const list = lane.wait(['ListRules'], metaId);
				if (!lane.send({type: 'ListRules', projectId: metaId})) {
					lane.cancel(list.token);
					return {ok: true as const, rules: added, replace: false};
				}
				try {
					const listed = await list.promise;
					if (listed.status === 'error') return {ok: true as const, rules: added, replace: false};
					return {ok: true as const, rules: rulesFromEvent(listed), replace: true};
				} catch {
					return {ok: true as const, rules: added, replace: false};
				}
			}),
		removeRule: (projectId, ruleId) =>
			runRuleOp(async () => {
				const metaId = lane.metaId(projectId);
				if (!metaId) return {ok: false as const, notice: 'Project not ready — wait for Engine Meta'};
				const r = await hostRequest(lane, ['RemoveRule'], {type: 'RemoveRule', id: ruleId}, {metaId});
				if (!r.ok) return r;
				if (r.event.status === 'error') return {ok: false as const, notice: r.event.message};
				return {ok: true as const};
			}),
		setRuleEnabled: (projectId, ruleId, enabled) =>
			runRuleOp(async () => {
				const metaId = lane.metaId(projectId);
				if (!metaId) return {ok: false as const, notice: 'Project not ready — wait for Engine Meta'};
				const r = await hostRequest(
					lane,
					['SetRuleEnabled'],
					{type: 'SetRuleEnabled', id: ruleId, enabled},
					{metaId}
				);
				if (!r.ok) return r;
				if (r.event.status === 'error') return {ok: false as const, notice: r.event.message};
				return {ok: true as const};
			})
	};
}
