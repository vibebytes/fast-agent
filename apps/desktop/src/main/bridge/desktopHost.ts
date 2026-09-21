/**
 * DesktopHost — product InvokeChannels implementation (no Electron import).
 * Pet / locale channels stay in the host entry; window/tray/media protocol stay there too.
 */
import {join} from 'node:path';
import type {CloudflareTunnelStatus, InvokeChannel, InvokeChannels} from '@fast-ide/session-view';
import {classifyProbeError, probeBridge} from '@fastllm/bridge-client';
import type {WorkspaceHub, WorkspaceProjectHandlers} from './WorkspaceHub.js';
import {hostSession} from './workspace/hostSession.js';
import {getDshModels, selectDshModel} from './dsh/models.js';
import {settingsCall} from './dsh/settings.js';
import {listDshSkills} from './dsh/skills.js';
import type {createUiPublisher} from './uiPublisher.js';
import {
	CONNECT_DEADLINE_MS,
	LOCAL_EDGE_ID,
	deleteServer,
	edgeUrl,
	edgesPath,
	isLoopbackHost,
	loadEdgesFile,
	openToken,
	publicServers,
	remoteConnection,
	saveEdgesFile,
	upsertServer,
	type TokenVault
} from '../remoteEdges.js';

export type ProductInvokeChannel = Exclude<
	InvokeChannel,
	'pet:getVisible' | 'pet:setVisible' | 'locale:getSystem' | 'locale:set'
>;

type Handler<C extends ProductInvokeChannel> = (
	...args: InvokeChannels[C]['args']
) => InvokeChannels[C]['result'] | Promise<InvokeChannels[C]['result']>;

export type ProductInvokeMap = {
	[C in ProductInvokeChannel]: Handler<C>;
};

export type UiPublisher = ReturnType<typeof createUiPublisher>;

export type DesktopHostDeps = {
	hub: WorkspaceHub;
	publisher: UiPublisher;
	getRestoreState: () => {done: boolean; failed: boolean; reason?: string};
	startHeartbeat: () => void;
	stopHeartbeat: () => void;
	/** Open a folder Project (validates Default path, Hub open, publish). */
	openProjectPath: (workspaceRoot: string) => void;
	projectHandlers: () => WorkspaceProjectHandlers;
	pickDirectory: () => Promise<string | null>;
	documentsDir: () => string;
	pathExists: (path: string) => boolean;
	mkdirp: (path: string) => void;
	showInFolder: (path: string) => void;
	readMedia: (
		root: string,
		relativePath: string
	) => Promise<InvokeChannels['fs:readMedia']['result']>;
	vault?: TokenVault;
	userData?: () => string;
	onEdgesChanged?: () => void;
	/** Engine pairing export via GetBridgePairing; null/undefined uses the engine-off empty. */
	mobilePairing?: () => Promise<InvokeChannels['mobile:pairingInfo']['result']> | InvokeChannels['mobile:pairingInfo']['result'] | null;
	setLanPairing?: (enabled: boolean) => Promise<InvokeChannels['mobile:setLanPairing']['result']>;
	/** Cloudflare Tunnel 通道（§cloudflare-tunnel-pairing.md §4.5.2）：主进程 manager。 */
	cloudflareTunnel?: {
		status: () => CloudflareTunnelStatus;
		start: () => CloudflareTunnelStatus;
		stop: () => CloudflareTunnelStatus;
	};
	probe?: typeof probeBridge;
};

async function writeEngineAndPublish(
	hub: WorkspaceHub,
	publisher: UiPublisher,
	type: Parameters<WorkspaceHub['writeEngine']>[0],
	id: string
): Promise<Awaited<ReturnType<WorkspaceHub['writeEngine']>>> {
	const res = await hub.writeEngine(type, id);
	if (res.ok) publisher.publishTasksMeta();
	return res;
}

export function createDesktopHost(deps: DesktopHostDeps): ProductInvokeMap {
	const {
		hub,
		publisher,
		getRestoreState,
		startHeartbeat,
		stopHeartbeat,
		openProjectPath,
		projectHandlers,
		pickDirectory,
		documentsDir,
		pathExists,
		mkdirp,
		showInFolder,
		readMedia,
		vault,
		userData,
		onEdgesChanged,
		probe = probeBridge
	} = deps;

	const edgesFile = () => loadEdgesFile(edgesPath(userData?.() ?? ''));
	const persistEdges = (file: ReturnType<typeof loadEdgesFile>) => {
		if (!userData) return;
		saveEdgesFile(edgesPath(userData()), file);
		onEdgesChanged?.();
	};
	const edgesList = (): InvokeChannels['edges:list']['result'] => {
		const snap = hub.edgeSnapshot();
		return {
			activeId: snap.activeId,
			pendingEdgeId: snap.pendingEdgeId,
			servers: userData ? publicServers(edgesFile()) : [],
			capabilities: snap.capabilities,
			hostHome: snap.hostHome,
			runActive: hub.hasInFlightRuns()
		};
	};

	const refusePending = (): InvokeChannels['edges:upsert']['result'] | null => {
		if (!hub.edgeSnapshot().pendingEdgeId) return null;
		return {ok: false, code: 'pending', message: 'Edge switch in progress'};
	};

	const remoteOptsFor = (
		row: Parameters<typeof remoteConnection>[0]
	) => remoteConnection(row, vault);

	return {
		'workspace:checkRestore': () => getRestoreState(),

		'project:open': async () => {
			if (hub.isRemote()) return null;
			const path = await pickDirectory();
			if (!path) return null;
			openProjectPath(path);
			return path;
		},

		'project:openRemote': async (serverPath: string) => {
			if (!hub.isRemote() || hub.edgeSnapshot().pendingEdgeId) return null;
			const snap = await hub.openRemoteProject(serverPath, projectHandlers());
			publisher.publishWorkspace();
			publisher.publishFocusChange();
			return snap.path;
		},

		'project:createBlank': async (name?: string) => {
			if (hub.isRemote()) return null;
			const trimmed = name?.trim() || 'New project';
			const safe =
				trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80) || 'New project';
			const documents = documentsDir();
			let root = join(documents, safe);
			if (pathExists(root)) {
				let n = 2;
				while (pathExists(join(documents, `${safe} ${n}`))) n += 1;
				root = join(documents, `${safe} ${n}`);
			}
			mkdirp(root);
			openProjectPath(root);
			return root;
		},

		'project:get': () => {
			const active = hub.getActive();
			const engine = hub.getEngineStatus();
			return {
				path: active?.path ?? null,
				projects: hub.listProjects(),
				activeProjectId: active?.id ?? null,
				projectTasks: publisher.buildProjectTaskLists(),
				projectTasksHydrated: publisher.buildProjectTasksHydrated(),
				engineStatus: engine.status,
				engineError: engine.error ?? null,
				bridgeConnectionId: hub.connectionId() ?? null
			};
		},

		'project:gitStatus': async (force?: boolean) => hub.gitWorkspaceStatus(force),

		'project:focus': (projectId: string) => {
			const ok = hub.focusProject(projectId);
			if (ok) {
				startHeartbeat();
				publisher.publishFocusChange();
			}
			return ok;
		},

		'project:close': (projectId: string) => {
			const ok = hub.closeProject(projectId);
			if (!hub.getActive()) stopHeartbeat();
			else startHeartbeat();
			publisher.publishWorkspace();
			publisher.publishFocusChange();
			return ok;
		},

		'project:showInFolder': (projectId: string) => {
			const project = hub.getById(projectId);
			if (!project) return false;
			showInFolder(project.path);
			return true;
		},

		'project:rename': (projectId: string, displayName: string) => {
			const trimmed = String(displayName ?? '').trim();
			if (!trimmed) return {ok: false as const, notice: 'Name required'};
			const project = hub.getById(projectId);
			if (!project) return {ok: false as const, notice: 'Project not found'};
			if (!project.metaProjectId) {
				return {ok: false as const, notice: 'Project not ready — wait for Engine Meta'};
			}
			const ok = hub.renameProjectDisplayName(projectId, trimmed);
			return ok
				? {ok: true as const}
				: {ok: false as const, notice: 'Failed to send rename to Engine'};
		},

		'settings:get': (scope, scopeId) => hub.getSettings(scope, scopeId),
		'settings:patch': (scope, namespace, patch, scopeId) =>
			hub.patchSettings(scope, namespace, patch, scopeId),

		'providers:list': () => hub.listProviders(),
		'providers:upsert': input => hub.upsertProvider(input),
		'providers:delete': (id: string) => hub.deleteProvider(id),
		'providers:setEnabled': (id: string, enabled: boolean) => hub.setProviderEnabled(id, enabled),
		'providers:test': (id: string) => hub.testProvider(id),
		'providers:patchModels': (id, patch) => hub.patchProviderModels(id, patch),
		'providers:searchModels': (id: string, query: string) => hub.searchProviderModels(id, query),

		'skills:list': () => hub.listSkills(),
		'skills:create': input => hub.createSkill(input),
		'skills:delete': (name: string, scope: string) => hub.deleteSkill(name, scope),
		'skills:setEnabled': (name: string, scope: string, enabled: boolean) =>
			hub.setSkillEnabled(name, scope, enabled),
		'skills:searchMarket': (query: string) => hub.searchSkillMarket(query),
		'skills:installMarket': (source: string, scope: string) =>
			hub.installSkillFromMarket(source, scope),
		'skills:uninstallMarket': (name: string, scope: string) =>
			hub.uninstallSkillFromMarket(name, scope),

		'extensions:list': () => hub.listExtensions(),
		'extensions:status': (id: string) => hub.extensionStatus(id),
		'extensions:install': (dir: string) => hub.installExtension(dir),
		'extensions:uninstall': (id: string) => hub.uninstallExtension(id),
		'extensions:pickDir': () => pickDirectory(),

		'engines:list': async () => {
			const res = await hub.listEngines();
			if (res.ok) publisher.publishTasksMeta();
			return res;
		},
		'engines:enable': id => writeEngineAndPublish(hub, publisher, 'EnableEngine', id),
		'engines:disable': id => writeEngineAndPublish(hub, publisher, 'DisableEngine', id),
		'engines:start': id => writeEngineAndPublish(hub, publisher, 'StartEngine', id),
		'engines:stop': id => writeEngineAndPublish(hub, publisher, 'StopEngine', id),
		'engines:setDefault': id => writeEngineAndPublish(hub, publisher, 'SetDefaultEngine', id),
		'engines:install': id => writeEngineAndPublish(hub, publisher, 'InstallEngine', id),
		'engines:uninstall': id => writeEngineAndPublish(hub, publisher, 'UninstallEngine', id),
		'engines:cancelInstall': id => writeEngineAndPublish(hub, publisher, 'CancelEngineInstall', id),

		'mcp:list': () => hub.listMcpServers(),
		'mcp:control': (name: string, op: string) => hub.mcpServerControl(name, op),
		'mcp:put': (name: string, config: unknown) => hub.mcpServerPut(name, config),
		'mcp:enabled': (name: string, enabled: boolean) => hub.mcpServerEnabled(name, enabled),
		'mcp:delete': (name: string) => hub.mcpServerDelete(name),
		'mcp:import': (payload: unknown) => hub.mcpConfigImport(payload),
		'mcp:reload': () => hub.mcpConfigReload(),

		'rules:list': (projectId: string) => hub.listRules(projectId),
		'rules:add': (projectId: string, text: string) => hub.addProjectRule(projectId, text),
		'rules:remove': (projectId: string, ruleId: string) => hub.removeRule(projectId, ruleId),
		'rules:setEnabled': (projectId: string, ruleId: string, enabled: boolean) =>
			hub.setRuleEnabled(projectId, ruleId, enabled),

		'review:list': (projectId: string, checkpointId?: string | null, sessionId?: string | null) =>
			hub.listReviewChanges(projectId, checkpointId, sessionId),
		'review:change': (projectId: string, changeId: string) => hub.getReviewChange(projectId, changeId),
		'review:diff': (projectId: string, sinceRevision?: number) =>
			hub.listReviewDiff(projectId, sinceRevision),
		'review:fileDiff': (projectId: string, path: string) => hub.getFileReviewDiff(projectId, path),
		'review:keep': (projectId: string, changeIds: string[], revision: number) =>
			hub.keepReviewChanges(projectId, changeIds, revision),
		'review:preview': (projectId, input) => hub.previewRevert(projectId, input),
		'review:apply': (projectId: string, previewId: string, force?: boolean) =>
			hub.applyRevert(projectId, previewId, force),
		'review:redo': (projectId: string, restoreId: string) => hub.redoRevert(projectId, restoreId),

		'schedule:list': (projectId?: string | null) => hub.listScheduledJobs(projectId),
		'schedule:listLiving': () => hub.listLivingTasks(),
		'schedule:create': input => hub.createScheduledJob(input),
		'schedule:pause': (id: string) => hub.pauseScheduledJob(id),
		'schedule:resume': (id: string) => hub.resumeScheduledJob(id),
		'schedule:cancel': (id: string) => hub.cancelScheduledJob(id),
		'schedule:fireNow': (id: string) => hub.fireNowScheduledJob(id),
		'schedule:updateCron': (id: string, cronExpr: string, timezone?: string) =>
			hub.updateScheduledJobCron(id, cronExpr, timezone),
		'schedule:listRuns': (id: string) => hub.listScheduledJobRuns(id),

		'teams:list': (projectId?: string | null) => hub.listTeams(projectId),
		'teams:listGoals': (projectId?: string | null, status?: string | null) =>
			hub.listGoals(projectId, status),
		'teams:listAgents': (projectId?: string | null, opts?: {includeArchived?: boolean}) =>
			hub.listAgents(projectId, opts),
		'teams:create': input => hub.createTeam(input),
		'teams:update': input => hub.updateTeam(input),
		'teams:archive': (teamId: string) => hub.archiveTeam(teamId),
		'teams:unarchive': (teamId: string) => hub.unarchiveTeam(teamId),
		'teams:get': (teamId: string) => hub.getTeam(teamId),
		'teams:getGoal': (goalId: string) => hub.getGoal(goalId),
		'teams:createAgent': input => hub.createAgent(input),
		'teams:updateAgent': input => hub.updateAgent(input),
		'teams:archiveAgent': (agentId: string) => hub.archiveAgent(agentId),
		'teams:unarchiveAgent': (agentId: string) => hub.unarchiveAgent(agentId),
		'teams:cloneAgent': input => hub.cloneAgent(input),
		'teams:getAgent': (agentId: string) => hub.getAgent(agentId),
		'teams:delete': (teamId: string) => hub.deleteTeam(teamId),
		'teams:saveAs': input => hub.saveAsTeam(input),
		'teams:promote': input => hub.promoteTeam(input),
		'teams:deleteAgent': (agentId: string) => hub.deleteAgent(agentId),
		'teams:stopAgentRun': (agentId: string) => hub.stopAgentRun(agentId),
		'teams:deleteGoal': (goalId: string) => hub.deleteGoal(goalId),

		...hostSession({
			hub,
			publisher,
			startHeartbeat,
			projectHandlers,
			showInFolder,
			pathExists,
			readMedia
		}),

		'engine:diagnostics': () => hub.bridgeDiagnostics(),

		'dsh:call': (method, payload, sessionId) => hub.engineCall(method, payload, sessionId),
		'dsh:models': sessionId => getDshModels(hub.engineCall.bind(hub), sessionId),
		'dsh:selectModel': input => selectDshModel(hub.engineCall.bind(hub), input),
		'dsh:skills': sessionId => listDshSkills(hub.engineCall.bind(hub), sessionId),
		'dsh:settings': op => settingsCall(hub.engineCall.bind(hub), op),

		'host:listDir': path => hub.listHostDir(path),
		'host:createDir': (parent, name) => hub.createHostDir(parent, name),

		'edges:list': () => edgesList(),

		'edges:get': id => {
			if (!userData || id === LOCAL_EDGE_ID) return null;
			const row = edgesFile().servers.find(s => s.id === id);
			if (!row) return null;
			return {
				id: row.id,
				name: row.name,
				ip: row.ip,
				port: row.port,
				token: openToken(row.token, vault),
				fingerprint: row.fingerprint,
				caPem: row.caPem,
				insecureSkipVerify: row.insecureSkipVerify
			};
		},

		'edges:upsert': async input => {
			const blocked = refusePending();
			if (blocked) return blocked;
			if (!userData) return {ok: false, code: 'error', message: 'No userData'};
			if (vault && !vault.isEncryptionAvailable()) {
				console.warn('safeStorage unavailable; remote edge token stored as plaintext (0600)');
			}
			const probed = await probe({
				url: edgeUrl(input.ip, input.port),
				authToken: input.token,
				fingerprint: input.fingerprint,
				caPem: input.caPem,
				timeoutMs: CONNECT_DEADLINE_MS
			});
			if (!probed.ok) return probed;
			try {
				const next = upsertServer(
					edgesFile(),
					{...input, fingerprint: input.fingerprint ?? probed.fingerprint, insecureSkipVerify: undefined},
					vault
				);
				persistEdges(next.file);
				return {ok: true, id: next.id};
			} catch (error) {
				return {
					ok: false,
					code: 'error',
					message: error instanceof Error ? error.message : String(error)
				};
			}
		},

		'edges:delete': async id => {
			const blocked = refusePending();
			if (blocked) return blocked;
			if (!userData) return {ok: false, code: 'error', message: 'No userData'};
			if (id === LOCAL_EDGE_ID) return {ok: false, code: 'error', message: 'Cannot delete local'};
			if (hub.edgeSnapshot().activeId === id) {
				try {
					await hub.switchEdge({id: LOCAL_EDGE_ID}, projectHandlers());
					publisher.publishWorkspace();
					publisher.publishFocusChange();
				} catch (error) {
					const classified = classifyProbeError(error);
					return {ok: false, code: classified.code, message: classified.message};
				}
				if (hub.edgeSnapshot().activeId !== LOCAL_EDGE_ID) {
					return {ok: false, code: 'error', message: 'Failed to switch to local before delete'};
				}
			}
			persistEdges(deleteServer(edgesFile(), id));
			return {ok: true};
		},

		'edges:select': async id => {
			const file = userData ? edgesFile() : null;
			try {
				if (id === LOCAL_EDGE_ID) {
					await hub.switchEdge({id: LOCAL_EDGE_ID}, projectHandlers());
				} else {
					const row = file?.servers.find(s => s.id === id);
					if (!row) return {ok: false, code: 'error', message: 'Unknown edge'};
					if (!row.fingerprint && !row.caPem && !isLoopbackHost(row.ip)) {
						return {
							ok: false,
							code: 'unpinned',
							message: 'Server identity is not pinned. Open Settings and confirm the fingerprint.'
						};
					}
					await hub.switchEdge({id, remote: remoteOptsFor(row)}, projectHandlers());
				}
				publisher.publishWorkspace();
				publisher.publishFocusChange();
				onEdgesChanged?.();
				return {ok: true};
			} catch (error) {
				if (error instanceof Error && error.name === 'AbortError') {
					return {ok: false, code: 'aborted', message: 'aborted'};
				}
				const classified = classifyProbeError(error);
				return {ok: false, code: classified.code, message: classified.message};
			}
		},

		'edges:test': async input => {
			const blocked = refusePending();
			if (blocked) return blocked;
			return probe({
				url: edgeUrl(input.ip, input.port),
				authToken: input.token,
				fingerprint: input.fingerprint,
				caPem: input.caPem,
				timeoutMs: CONNECT_DEADLINE_MS
			});
		},

		'mobile:pairingInfo': () =>
			deps.mobilePairing?.() ?? {
				available: false,
				reason: 'engine',
				host: '',
				port: 0,
				serverUrl: '',
				token: '',
				fingerprint: ''
			},

		'mobile:setLanPairing': input =>
			deps.setLanPairing?.(input) ?? {
				available: false,
				reason: 'engine',
				host: '',
				port: 0,
				serverUrl: '',
				token: '',
				fingerprint: ''
			},

		'cloudflareTunnel:status': () => deps.cloudflareTunnel?.status() ?? {state: 'disabled'},
		'cloudflareTunnel:start': () => deps.cloudflareTunnel?.start() ?? {state: 'disabled'},
		'cloudflareTunnel:stop': () => deps.cloudflareTunnel?.stop() ?? {state: 'disabled'}
	};
}
