import {contextBridge, ipcRenderer, webUtils} from 'electron';
import type {
	InvokeArgs,
	InvokeChannel,
	InvokeChannels,
	PushChannel,
	PushChannels
} from '@fast-ide/session-view';
import type {FastIdeApi} from '../shared/fastIdeApi.js';

function invoke<C extends InvokeChannel>(
	channel: C,
	...args: InvokeArgs<C>
): Promise<InvokeChannels[C]['result']> {
	return ipcRenderer.invoke(channel, ...args) as Promise<InvokeChannels[C]['result']>;
}

function onPush<C extends PushChannel>(
	channel: C,
	handler: (payload: PushChannels[C]) => void
): () => void {
	const listener = (_: Electron.IpcRendererEvent, payload: PushChannels[C]) => handler(payload);
	ipcRenderer.on(channel, listener);
	return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
	platform: process.platform as FastIdeApi['platform'],
	openProject: () => invoke('project:open'),
	openRemoteProject: (path: string) => invoke('project:openRemote', path),
	listHostDir: (path?: string) => invoke('host:listDir', path),
	createHostDir: (parent, name) => invoke('host:createDir', parent, name),
	listEdges: () => invoke('edges:list'),
	getEdge: (id: string) => invoke('edges:get', id),
	upsertEdge: input => invoke('edges:upsert', input),
	deleteEdge: (id: string) => invoke('edges:delete', id),
	selectEdge: (id: string) => invoke('edges:select', id),
	testEdge: input => invoke('edges:test', input),
	mobilePairingInfo: () => invoke('mobile:pairingInfo'),
	onEdgesChanged: handler => onPush('edges:changed', handler),
	createBlankProject: (name?: string) => invoke('project:createBlank', name),
	getProject: () => invoke('project:get'),
	gitStatus: (force?: boolean) => invoke('project:gitStatus', force),
	focusProject: (projectId: string) => invoke('project:focus', projectId),
	closeProject: (projectId: string) => invoke('project:close', projectId),
	showProjectInFolder: (projectId: string) => invoke('project:showInFolder', projectId),
	renameProject: (projectId: string, displayName: string) =>
		invoke('project:rename', projectId, displayName),
	getSettings: (scope: 'global' | 'project' | 'effective', scopeId?: string) =>
		invoke('settings:get', scope, scopeId),
	patchSettings: (scope: 'global' | 'project', namespace: string, patch: unknown, scopeId?: string) =>
		invoke('settings:patch', scope, namespace, patch, scopeId),
	listProviders: () => invoke('providers:list'),
	upsertProvider: input => invoke('providers:upsert', input),
	deleteProvider: (id: string) => invoke('providers:delete', id),
	setProviderEnabled: (id: string, enabled: boolean) => invoke('providers:setEnabled', id, enabled),
	testProvider: (id: string) => invoke('providers:test', id),
	patchProviderModels: (id, patch) => invoke('providers:patchModels', id, patch),
	searchProviderModels: (id: string, query: string) => invoke('providers:searchModels', id, query),
	listSkills: () => invoke('skills:list'),
	createSkill: input => invoke('skills:create', input),
	deleteSkill: (name: string, scope: string) => invoke('skills:delete', name, scope),
	setSkillEnabled: (name: string, scope: string, enabled: boolean) =>
		invoke('skills:setEnabled', name, scope, enabled),
	searchSkillMarket: (query: string) => invoke('skills:searchMarket', query),
	installSkillFromMarket: (source: string, scope: string) =>
		invoke('skills:installMarket', source, scope),
	uninstallSkillFromMarket: (name: string, scope: string) =>
		invoke('skills:uninstallMarket', name, scope),
	listExtensions: () => invoke('extensions:list'),
	extensionStatus: (id: string) => invoke('extensions:status', id),
	installExtension: (dir: string) => invoke('extensions:install', dir),
	uninstallExtension: (id: string) => invoke('extensions:uninstall', id),
	pickExtensionDir: () => invoke('extensions:pickDir'),
	listEngines: () => invoke('engines:list'),
	enableEngine: (id: string) => invoke('engines:enable', id),
	disableEngine: (id: string) => invoke('engines:disable', id),
	startEngine: (id: string) => invoke('engines:start', id),
	stopEngine: (id: string) => invoke('engines:stop', id),
	setDefaultEngine: (id: string) => invoke('engines:setDefault', id),
	installEngine: (id: string) => invoke('engines:install', id),
	uninstallEngine: (id: string) => invoke('engines:uninstall', id),
	cancelEngineInstall: (id: string) => invoke('engines:cancelInstall', id),
	onEngineInstallLog: handler => onPush('engines:installLog', handler),
	listRules: (projectId: string) => invoke('rules:list', projectId),
	addProjectRule: (projectId: string, text: string) => invoke('rules:add', projectId, text),
	removeRule: (projectId: string, ruleId: string) => invoke('rules:remove', projectId, ruleId),
	setRuleEnabled: (projectId: string, ruleId: string, enabled: boolean) =>
		invoke('rules:setEnabled', projectId, ruleId, enabled),
	listReviewChanges: (projectId: string, checkpointId?: string | null, sessionId?: string | null) =>
		invoke('review:list', projectId, checkpointId, sessionId),
	getReviewChange: (projectId: string, changeId: string) =>
		invoke('review:change', projectId, changeId),
	listReviewDiff: (projectId: string, sinceRevision?: number) =>
		invoke('review:diff', projectId, sinceRevision),
	getFileReviewDiff: (projectId: string, path: string) =>
		invoke('review:fileDiff', projectId, path),
	keepReviewChanges: (projectId: string, changeIds: string[], revision: number) =>
		invoke('review:keep', projectId, changeIds, revision),
	previewRevert: (
		projectId: string,
		input: {
			target: 'timeline' | 'whole' | 'pending' | 'changes';
			revision: number;
			checkpointId?: string;
			changeIds?: string[];
		}
	) => invoke('review:preview', projectId, input),
	applyRevert: (projectId: string, previewId: string, force?: boolean) =>
		invoke('review:apply', projectId, previewId, force),
	redoRevert: (projectId: string, restoreId: string) => invoke('review:redo', projectId, restoreId),
	listScheduledJobs: (projectId?: string | null) => invoke('schedule:list', projectId),
	listLivingTasks: () => invoke('schedule:listLiving'),
	createScheduledJob: input => invoke('schedule:create', input),
	pauseScheduledJob: (id: string) => invoke('schedule:pause', id),
	resumeScheduledJob: (id: string) => invoke('schedule:resume', id),
	cancelScheduledJob: (id: string) => invoke('schedule:cancel', id),
	fireNowScheduledJob: (id: string) => invoke('schedule:fireNow', id),
	updateScheduledJobCron: (id: string, cronExpr: string, timezone?: string) =>
		invoke('schedule:updateCron', id, cronExpr, timezone),
	listScheduledJobRuns: (id: string) => invoke('schedule:listRuns', id),
	listTeams: (projectId?: string | null) => invoke('teams:list', projectId),
	listGoals: (projectId?: string | null, status?: string | null) =>
		invoke('teams:listGoals', projectId, status),
	listAgents: (projectId?: string | null, opts?: {includeArchived?: boolean}) =>
		invoke('teams:listAgents', projectId, opts),
	createTeam: input => invoke('teams:create', input),
	updateTeam: input => invoke('teams:update', input),
	archiveTeam: (teamId: string) => invoke('teams:archive', teamId),
	unarchiveTeam: (teamId: string) => invoke('teams:unarchive', teamId),
	getTeam: (teamId: string) => invoke('teams:get', teamId),
	getGoal: (goalId: string) => invoke('teams:getGoal', goalId),
	createAgent: input => invoke('teams:createAgent', input),
	updateAgent: input => invoke('teams:updateAgent', input),
	archiveAgent: (agentId: string) => invoke('teams:archiveAgent', agentId),
	unarchiveAgent: (agentId: string) => invoke('teams:unarchiveAgent', agentId),
	cloneAgent: input => invoke('teams:cloneAgent', input),
	getAgent: (agentId: string) => invoke('teams:getAgent', agentId),
	deleteTeam: (teamId: string) => invoke('teams:delete', teamId),
	saveAsTeam: input => invoke('teams:saveAs', input),
	promoteTeam: input => invoke('teams:promote', input),
	deleteAgent: (agentId: string) => invoke('teams:deleteAgent', agentId),
	stopAgentRun: (agentId: string) => invoke('teams:stopAgentRun', agentId),
	deleteGoal: (goalId: string) => invoke('teams:deleteGoal', goalId),
	showTaskProjectInFolder: (taskId: string) => invoke('task:showProjectInFolder', taskId),
	showWorkspacePathInFolder: (relativePath: string) =>
		invoke('workspace:showInFolder', relativePath),
	listWorkspaceDir: (relativePath?: string) => invoke('listWorkspaceDir', relativePath),
	getWorkspaceFile: (relativePath: string) => invoke('getWorkspaceFile', relativePath),
	saveWorkspaceFile: (relativePath: string, content: string, mtime?: number, bytes?: number) =>
		invoke('saveWorkspaceFile', relativePath, content, mtime, bytes),
	readMedia: (relativePath: string) => invoke('fs:readMedia', relativePath),
	getPathForFile: file => {
		try {
			type FileArg = Parameters<typeof webUtils.getPathForFile>[0];
			return webUtils.getPathForFile(file as unknown as FileArg);
		} catch {
			return '';
		}
	},
	createTask: (title?: string, projectId?: string) => invoke('task:create', title, projectId),
	createChat: (title?: string) => invoke('chat:create', title),
	getPetVisible: () => invoke('pet:getVisible'),
	setPetVisible: (visible: boolean) => invoke('pet:setVisible', visible),
	getSystemLocale: () => invoke('locale:getSystem'),
	setLocalePref: (pref: string) => invoke('locale:set', {pref}),
	selectTask: (taskId: string, focusEpoch?: number) => invoke('task:select', taskId, focusEpoch),
	ensureTasksLive: (taskIds: string[]) => invoke('task:ensureLive', taskIds),
	openLivingSession: (sessionId: string, metaProjectId?: string | null) =>
		invoke('task:openLiving', sessionId, metaProjectId),
	renameTask: (taskId: string, title: string) => invoke('task:rename', taskId, title),
	deleteTask: (taskId: string, sessionId?: string | null) =>
		invoke('task:delete', taskId, sessionId),
	sendMessage: (text, mentions, expectedTaskId) =>
		invoke('task:send', text, mentions, expectedTaskId),
	buildPlan: (planId, name) => invoke('task:buildPlan', planId, name),
	mentionSuggest: (prefix, requestId, kinds) =>
		invoke('mention:suggest', prefix, requestId, kinds),
	listTasks: () => invoke('task:list'),
	decideApproval: (approvalId: string, approved: boolean, reason?: string) =>
		invoke('task:approve', approvalId, approved, reason),
	confirmGoal: (patchJson?: string) => invoke('goal:confirm', patchJson),
	pauseGoal: (goalId?: string) => invoke('goal:pause', goalId),
	cancelGoal: (goalId?: string) => invoke('goal:cancel', goalId),
	resumeGoal: (goalId?: string) => invoke('goal:resume', goalId),
	steerGoal: (note: string, goalId?: string) => invoke('goal:steer', note, goalId),
	escalateGoal: (action: 'resume' | 'fail') => invoke('goal:escalate', action),
	dismissGoalCard: () => invoke('goal:dismiss'),
	answerQuestion: (questionId: string, answer: string) =>
		invoke('task:answer', questionId, answer),
	answerQuestionBatch: (rpcId, payload) => invoke('task:answerBatch', rpcId, payload),
	cancelRun: (reason?: string) => invoke('task:cancel', reason),
	rerunRun: (runId: string) => invoke('task:rerun', runId),
	killProc: (procId: string, reason?: string, sessionId?: string) =>
		invoke('task:killProc', procId, reason, sessionId),
	requestOlderHistory: () => invoke('task:requestOlderHistory'),
	requestModelList: () => invoke('model:list'),
	requestSlashCatalog: () => invoke('slash:list'),
	selectModel: (modelId: string) => invoke('model:select', modelId),
	setRunMode: (mode: string, expectedTaskId) => invoke('mode:set', mode, expectedTaskId),
	setEngineKind: (kind: string, expectedTaskId) => invoke('engineKind:set', kind, expectedTaskId),
	setModelSettings: settings => invoke('model:settings', settings),
	removeQueueItem: (itemId: string) => invoke('queue:remove', itemId),
	clearQueue: () => invoke('queue:clear'),
	reorderQueue: (fromIndex: number, toIndex: number) =>
		invoke('queue:reorder', fromIndex, toIndex),
	editQueueItem: (itemId: string, text: string) => invoke('queue:edit', itemId, text),
	setQueuePaused: (paused: boolean) => invoke('queue:pause', paused),
	interruptQueueItem: (itemId: string) => invoke('queue:interrupt', itemId),
	dshSteer: (text: string) => invoke('dsh:steer', text),
	dshGoalAct: (action: 'pause' | 'resume' | 'complete' | 'clear') => invoke('dshGoal:act', action),
	retryEngine: () => invoke('engine:retry'),
	checkRestoreState: () => invoke('workspace:checkRestore'),
	onProjectsChanged: handler => onPush('projects:changed', handler),
	onWorkspaceFocus: handler => onPush('workspace:focus', handler),
	onProjectChanged: handler => onPush('project:changed', handler),
	onTasksChanged: handler => onPush('tasks:changed', handler),
	onTranscriptPatched: handler => onPush('transcript:patched', handler),
	onTranscriptTailPatched: handler => onPush('transcript:tailPatched', handler),
	onBridgeEvent: handler => onPush('bridge:event', handler),
	onBridgeError: handler => onPush('bridge:error', handler),
	onWorkspaceRestored: handler => onPush('workspace:restored', () => handler()),
	onWorkspaceRestoreFailed: handler => onPush('workspace:restoreFailed', handler),
	onSettingsChanged: handler => onPush('settings:changed', handler),
	onProvidersChanged: handler => onPush('providers:changed', handler),
	onSkillsChanged: handler => onPush('skills:changed', handler),
	onCompletionCue: handler => onPush('completion:cue', handler),
	getDshModels: sessionId => invoke('dsh:models', sessionId),
	selectDshModel: input => invoke('dsh:selectModel', input),
	listDshSkills: sessionId => invoke('dsh:skills', sessionId),
	dshSettings: {
		describe: () => invoke('dsh:settings', {op: 'describe'}),
		update: input => invoke('dsh:settings', {op: 'update', ...input}),
		mutate: input => invoke('dsh:settings', {op: 'mutate', ...input}),
		replace: input => invoke('dsh:settings', {op: 'replace', ...input}),
		openDocument: () => invoke('dsh:settings', {op: 'openDocument'}),
		credentialsDescribe: refs => invoke('dsh:settings', {op: 'credentialsDescribe', refs}),
		credentialsSet: (ref, value) => invoke('dsh:settings', {op: 'credentialsSet', ref, value}),
		credentialsUnset: ref => invoke('dsh:settings', {op: 'credentialsUnset', ref}),
		llmModels: () => invoke('dsh:settings', {op: 'llmModels'}),
		llmProviders: () => invoke('dsh:settings', {op: 'llmProviders'}),
		llmDiscoverModels: input => invoke('dsh:settings', {op: 'llmDiscoverModels', input}),
		agentPresetList: () => invoke('dsh:settings', {op: 'agentPresetList'}),
		agentPresetSelect: (sessionId, agentPreset) =>
			invoke('dsh:settings', {op: 'agentPresetSelect', sessionId, agentPreset}),
		agentPresetRead: agentPreset => invoke('dsh:settings', {op: 'agentPresetRead', agentPreset}),
		agentPresetCopy: input => invoke('dsh:settings', {op: 'agentPresetCopy', ...input}),
		agentPresetOpenDocument: agentPreset =>
			invoke('dsh:settings', {op: 'agentPresetOpenDocument', agentPreset}),
		agentPresetRemove: agentPreset => invoke('dsh:settings', {op: 'agentPresetRemove', agentPreset}),
		sessionList: () => invoke('dsh:settings', {op: 'sessionList'}),
		pluginInventoryList: () => invoke('dsh:settings', {op: 'pluginInventoryList'})
	},
	dshCall: (method, payload, sessionId) => invoke('dsh:call', method, payload, sessionId)
} satisfies FastIdeApi;

contextBridge.exposeInMainWorld('fastIde', api);
