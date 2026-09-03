import type {
	AgentRow,
	AmbientRule,
	DshCallResult,
	DshModelsResult,
	EdgeDeleteResult,
	EdgeDetail,
	EdgeSelectResult,
	EdgeTestInput,
	EdgeTestResult,
	EdgeUpsertInput,
	EdgeUpsertResult,
	EdgesList,
	HostDirCreateResult,
	HostDirResult,
	EngineWireRow,
	DshSelection,
	DshSettingsPathOp,
	DshSkillsResult,
	BridgeErrorEnvelope,
	BridgeEventEnvelope,
	CreateSkillInput,
	GitStatus,
	GetWorkspaceFileResult,
	ListWorkspaceDirResult,
	MarketSkillRow,
	MentionChip,
	MobilePairingInfo,
	ModelCatalogEntry,
	ProjectGetResult,
	ProjectSnapshot,
	ProjectState,
	ProjectsSnapshot,
	ProviderModelPatch,
	ProviderRow,
	QueueItem,
	ReadMediaResult,
	SaveWorkspaceFileResult,
	ReviewChangeDetail,
	FileReviewDiff,
	ReviewDiffSnapshot,
	ReviewList,
	ReviewPreview,
	ReviewRefusal,
	ReviewRestored,
	SearchModelRow,
	SendMessageResult,
	SettingsDoc,
	CompletionCue,
	SettingsScope,
	SkillRow,
	TaskMutationResult,
	UpsertProviderInput,
	TaskSelectTrace,
	TaskSummary,
	TasksMeta,
	TasksSnapshot,
	TeamRow,
	TranscriptPatch,
	TranscriptTailPatch,
	WorkspaceFocus
} from '@fast-ide/session-view';
import type {ExtNote, ExtRow} from '@fastllm/bridge-client';

/** Electron `process.platform` without requiring NodeJS namespace in the renderer tsconfig. */
export type HostPlatform =
	| 'aix'
	| 'android'
	| 'darwin'
	| 'freebsd'
	| 'haiku'
	| 'linux'
	| 'openbsd'
	| 'sunos'
	| 'win32'
	| 'cygwin'
	| 'netbsd';

/** Structural stand-in for DOM File so shared types stay DOM-lib free (node+web tsconfigs). */
export type HostFileRef = {
	readonly name: string;
	readonly type: string;
};

/**
 * Preload-exposed host API (semantic methods over typed Invoke/Push channels).
 * Wire channel maps live in `@fast-ide/session-view`; this adapter stays desktop-local.
 */
export type FastIdeApi = {
	platform: HostPlatform;
	openProject: () => Promise<string | null>;
	openRemoteProject: (path: string) => Promise<string | null>;
	listHostDir: (path?: string) => Promise<HostDirResult>;
	createHostDir: (parent: string, name: string) => Promise<HostDirCreateResult>;
	listEdges: () => Promise<EdgesList>;
	getEdge: (id: string) => Promise<EdgeDetail | null>;
	upsertEdge: (input: EdgeUpsertInput) => Promise<EdgeUpsertResult>;
	deleteEdge: (id: string) => Promise<EdgeDeleteResult>;
	selectEdge: (id: string) => Promise<EdgeSelectResult>;
	testEdge: (input: EdgeTestInput) => Promise<EdgeTestResult>;
	mobilePairingInfo: () => Promise<MobilePairingInfo>;
	onEdgesChanged: (handler: (payload: EdgesList) => void) => () => void;
	createBlankProject: (name?: string) => Promise<string | null>;
	getProject: () => Promise<ProjectGetResult>;
	gitStatus: (force?: boolean) => Promise<GitStatus | null>;
	focusProject: (projectId: string) => Promise<boolean>;
	closeProject: (projectId: string) => Promise<boolean>;
	showProjectInFolder: (projectId: string) => Promise<boolean>;
	renameProject: (projectId: string, displayName: string) => Promise<TaskMutationResult>;
	/** Settings-center documents (Engine DB; settings-center-storage.md). */
	getSettings: (
		scope: SettingsScope,
		scopeId?: string
	) => Promise<{ok: true; settings: SettingsDoc[]} | {ok: false; notice: string}>;
	/** RFC 7386 merge-patch one namespace; `null` field values delete. */
	patchSettings: (
		scope: 'global' | 'project',
		namespace: string,
		patch: unknown,
		scopeId?: string
	) => Promise<{ok: true; setting: SettingsDoc} | {ok: false; notice: string}>;
	/** Settings-center model providers (Engine Meta; never returns ciphertext). */
	listProviders: () => Promise<{ok: true; providers: ProviderRow[]} | {ok: false; notice: string}>;
	upsertProvider: (
		input: UpsertProviderInput
	) => Promise<{ok: true; provider: ProviderRow} | {ok: false; notice: string}>;
	deleteProvider: (id: string) => Promise<{ok: true} | {ok: false; notice: string}>;
	setProviderEnabled: (
		id: string,
		enabled: boolean
	) => Promise<{ok: true; provider: ProviderRow} | {ok: false; notice: string}>;
	testProvider: (
		id: string
	) => Promise<{ok: true; provider: ProviderRow} | {ok: false; notice: string}>;
	patchProviderModels: (
		id: string,
		patch: ProviderModelPatch[]
	) => Promise<{ok: true; provider: ProviderRow} | {ok: false; notice: string}>;
	searchProviderModels: (
		id: string,
		query: string
	) => Promise<{ok: true; searchModels: SearchModelRow[]} | {ok: false; notice: string}>;
	/** Settings-center skills (disk SoT + Skills.sh market). */
	listSkills: () => Promise<{ok: true; skills: SkillRow[]} | {ok: false; notice: string}>;
	createSkill: (
		input: CreateSkillInput
	) => Promise<{ok: true; skill: SkillRow} | {ok: false; notice: string}>;
	deleteSkill: (name: string, scope: string) => Promise<{ok: true} | {ok: false; notice: string}>;
	setSkillEnabled: (
		name: string,
		scope: string,
		enabled: boolean
	) => Promise<{ok: true; skill: SkillRow} | {ok: false; notice: string}>;
	searchSkillMarket: (
		query: string
	) => Promise<
		{ok: true; marketSkills: MarketSkillRow[]; message?: string} | {ok: false; notice: string}
	>;
	installSkillFromMarket: (
		source: string,
		scope: string
	) => Promise<{ok: true} | {ok: false; notice: string}>;
	uninstallSkillFromMarket: (
		name: string,
		scope: string
	) => Promise<{ok: true} | {ok: false; notice: string}>;
	listExtensions: () => Promise<
		{ok: true; extensions: ExtRow[]; ledger: ExtNote[]} | {ok: false; notice: string}
	>;
	extensionStatus: (
		id: string
	) => Promise<{ok: true; extension: ExtRow | null} | {ok: false; notice: string}>;
	installExtension: (dir: string) => Promise<{ok: true; id: string} | {ok: false; notice: string}>;
	uninstallExtension: (id: string) => Promise<{ok: true} | {ok: false; notice: string}>;
	pickExtensionDir: () => Promise<string | null>;
	listEngines: () => Promise<{ok: true; engines: EngineWireRow[]} | {ok: false; notice: string}>;
	enableEngine: (id: string) => Promise<{ok: true; engines: EngineWireRow[]} | {ok: false; notice: string}>;
	disableEngine: (id: string) => Promise<{ok: true; engines: EngineWireRow[]} | {ok: false; notice: string}>;
	startEngine: (id: string) => Promise<{ok: true; engines: EngineWireRow[]} | {ok: false; notice: string}>;
	stopEngine: (id: string) => Promise<{ok: true; engines: EngineWireRow[]} | {ok: false; notice: string}>;
	setDefaultEngine: (
		id: string
	) => Promise<{ok: true; engines: EngineWireRow[]} | {ok: false; notice: string}>;
	installEngine: (id: string) => Promise<{ok: true; engines: EngineWireRow[]} | {ok: false; notice: string}>;
	uninstallEngine: (id: string) => Promise<{ok: true; engines: EngineWireRow[]} | {ok: false; notice: string}>;
	cancelEngineInstall: (
		id: string
	) => Promise<{ok: true; engines: EngineWireRow[]} | {ok: false; notice: string}>;
	onEngineInstallLog: (
		handler: (log: {engineId: string; stream: 'stdout' | 'stderr'; text: string; seq: number}) => void
	) => () => void;
	listRules: (
		projectId: string
	) => Promise<{ok: true; rules: AmbientRule[]; replace: true} | {ok: false; notice: string}>;
	addProjectRule: (
		projectId: string,
		text: string
	) => Promise<
		| {ok: true; rules: AmbientRule[]; replace: boolean}
		| {ok: false; notice: string}
	>;
	removeRule: (projectId: string, ruleId: string) => Promise<TaskMutationResult>;
	setRuleEnabled: (
		projectId: string,
		ruleId: string,
		enabled: boolean
	) => Promise<TaskMutationResult>;
	/**
	 * Agent change review. Every call names a Project, never a path, so the renderer cannot aim a
	 * daemon write outside the checkout. `undoReview` is two-phase on purpose: `previewRevert` plans
	 * without writing, and only `applyRevert` touches files.
	 */
	listReviewChanges: (
		projectId: string,
		checkpointId?: string | null,
		sessionId?: string | null
	) => Promise<{ok: true; list: ReviewList} | ReviewRefusal>;
	getReviewChange: (
		projectId: string,
		changeId: string
	) => Promise<{ok: true; change: ReviewChangeDetail} | ReviewRefusal>;
	listReviewDiff: (
		projectId: string,
		sinceRevision?: number
	) => Promise<{ok: true; diff: ReviewDiffSnapshot} | ReviewRefusal>;
	getFileReviewDiff: (
		projectId: string,
		path: string
	) => Promise<{ok: true; file: FileReviewDiff} | ReviewRefusal>;
	keepReviewChanges: (
		projectId: string,
		changeIds: string[],
		revision: number
	) => Promise<{ok: true} | ReviewRefusal>;
	previewRevert: (
		projectId: string,
		input: {
			target: 'timeline' | 'whole' | 'pending' | 'changes';
			revision: number;
			checkpointId?: string;
			changeIds?: string[];
		}
	) => Promise<{ok: true; preview: ReviewPreview} | ReviewRefusal>;
	applyRevert: (
		projectId: string,
		previewId: string,
		force?: boolean
	) => Promise<{ok: true; restored: ReviewRestored} | ReviewRefusal>;
	redoRevert: (
		projectId: string,
		restoreId: string
	) => Promise<{ok: true; restored: ReviewRestored} | ReviewRefusal>;
	listScheduledJobs: (projectId?: string | null) => Promise<
		| {
				ok: true;
				jobs: Array<{
					id: string;
					kind: string;
					status: string;
					sessionId: string;
					projectId?: string | null;
					projectDisplayName?: string | null;
					cronExpr?: string | null;
					timezone?: string | null;
					nextFireAt?: string | null;
					title?: string | null;
					promptText?: string | null;
					targetKind?: string | null;
					targetRef?: string | null;
				}>;
		  }
		| {ok: false; notice: string}
	>;
	/** Cross-project LivingTask tree; renderer normalizes via asLivingProjects. */
	listLivingTasks: () => Promise<
		| {ok: true; projects: Array<{projectId: string; displayName?: string; sessions?: unknown[]}>}
		| {ok: false; notice: string}
	>;
	createScheduledJob: (input: {
		kind: string;
		cronExpr: string;
		timezone?: string;
		recurring?: boolean;
		targetKind: string;
		targetRef?: string;
		promptText?: string;
		targetArgsJson?: string;
		maxFires?: number;
		title?: string;
		fireImmediately?: boolean;
		sessionId?: string;
		projectId?: string;
	}) => Promise<
		| {
				ok: true;
				job: {
					id: string;
					kind: string;
					status: string;
					sessionId: string;
					projectId?: string | null;
					projectDisplayName?: string | null;
					cronExpr?: string | null;
					timezone?: string | null;
					nextFireAt?: string | null;
					title?: string | null;
					promptText?: string | null;
					targetKind?: string | null;
					targetRef?: string | null;
				};
		  }
		| {ok: false; notice: string}
	>;
	pauseScheduledJob: (id: string) => Promise<TaskMutationResult>;
	resumeScheduledJob: (id: string) => Promise<TaskMutationResult>;
	cancelScheduledJob: (id: string) => Promise<TaskMutationResult>;
	fireNowScheduledJob: (id: string) => Promise<TaskMutationResult>;
	updateScheduledJobCron: (
		id: string,
		cronExpr: string,
		timezone?: string
	) => Promise<TaskMutationResult>;
	listScheduledJobRuns: (id: string) => Promise<
		| {
				ok: true;
				runs: Array<{
					id: string;
					jobId: string;
					sessionId: string;
					status: string;
					startedAt?: string | null;
					finishedAt?: string | null;
					summary?: string | null;
					error?: string | null;
					runId?: string | null;
				}>;
		  }
		| {ok: false; notice: string}
	>;
	listTeams: (
		projectId?: string | null
	) => Promise<{ok: true; teams: TeamRow[]} | {ok: false; notice: string}>;
	listGoals: (
		projectId?: string | null,
		status?: string | null
	) => Promise<
		| {
				ok: true;
				goals: Array<{
					id: string;
					status: string;
					name?: string | null;
					statement?: string | null;
					acceptance?: string | null;
					originSessionId?: string | null;
					controlSessionId?: string | null;
					teamId?: string | null;
					projectId?: string | null;
					projectDisplayName?: string | null;
					currentStepIds?: string[] | null;
					activeRunIds?: string[] | null;
					/** @deprecated wire dual-read — prefer currentStepIds */
					currentStepId?: string | string[] | null;
					/** @deprecated wire dual-read — prefer activeRunIds */
					activeRunId?: string | string[] | null;
					confirmedAt?: string | null;
					resultSummary?: string | null;
					escalateActions?: string[];
					workflowJson?: string | null;
					budgetJson?: string | null;
					progressJson?: string | null;
					loopAgentId?: string | null;
				}>;
		  }
		| {ok: false; notice: string}
	>;
	listAgents: (
		projectId?: string | null,
		opts?: {includeArchived?: boolean}
	) => Promise<{ok: true; agents: AgentRow[]} | {ok: false; notice: string}>;
	getGoal: (goalId: string) => Promise<
		| {
				ok: true;
				goal: {
					id: string;
					status: string;
					name?: string | null;
					statement?: string | null;
					projectId?: string | null;
					projectDisplayName?: string | null;
					teamId?: string | null;
					originSessionId?: string | null;
					workflowJson?: string | null;
					budgetJson?: string | null;
					progressJson?: string | null;
					currentStepIds?: string[] | null;
					activeRunIds?: string[] | null;
					/** @deprecated wire dual-read — prefer currentStepIds */
					currentStepId?: string | string[] | null;
					/** @deprecated wire dual-read — prefer activeRunIds */
					activeRunId?: string | string[] | null;
					confirmedAt?: string | null;
				};
		  }
		| {ok: false; notice: string}
	>;
	createTeam: (input: {
		name: string;
		projectId: string;
		description?: string;
		workspaceId?: string;
		members?: Array<{name: string; teamRole: string; taskBrief?: string; model?: string}>;
	}) => Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}>;
	updateTeam: (input: {
		teamId: string;
		name?: string;
		description?: string;
		members?: Array<{name: string; teamRole: string; taskBrief?: string; model?: string}>;
	}) => Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}>;
	archiveTeam: (teamId: string) => Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}>;
	unarchiveTeam: (teamId: string) => Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}>;
	deleteTeam: (teamId: string) => Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}>;
	saveAsTeam: (input: {
		sourceTeamId: string;
		name?: string;
	}) => Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}>;
	promoteTeam: (input: {
		teamId: string;
		name?: string;
	}) => Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}>;
	getTeam: (teamId: string) => Promise<{ok: true; team: TeamRow} | {ok: false; notice: string}>;
	createAgent: (input: {
		name: string;
		projectId: string;
		model?: string;
		teamRole?: string;
		teamId?: string;
		taskBrief?: string;
	}) => Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}>;
	updateAgent: (input: {
		agentId: string;
		name?: string;
		model?: string;
		teamRole?: string;
		teamId?: string;
		taskBrief?: string;
		systemPrompt?: string;
		maxTurns?: number;
	}) => Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}>;
	archiveAgent: (agentId: string) => Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}>;
	unarchiveAgent: (
		agentId: string
	) => Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}>;
	cloneAgent: (input: {
		sourceId: string;
		teamId: string;
		name?: string;
	}) => Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}>;
	getAgent: (agentId: string) => Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}>;
	deleteAgent: (agentId: string) => Promise<{ok: true; agent: AgentRow} | {ok: false; notice: string}>;
	stopAgentRun: (
		agentId: string
	) => Promise<{ok: true; notice?: string} | {ok: false; notice: string}>;
	deleteGoal: (
		goalId: string
	) => Promise<
		| {
				ok: true;
				goal: {id: string; status: string; name?: string | null; projectId?: string | null};
		  }
		| {ok: false; notice: string}
	>;
	showTaskProjectInFolder: (taskId: string) => Promise<boolean>;
	/** Files pane menu — reveal a workspace-relative entry in the OS file manager. */
	showWorkspacePathInFolder: (relativePath: string) => Promise<boolean>;
	/** Bridge ListWorkspaceDir — active Project host stamp; no local root. */
	listWorkspaceDir: (relativePath?: string) => Promise<ListWorkspaceDirResult>;
	/** Bridge GetWorkspaceFile — text ≤2MB; too-large/binary refuse open. */
	getWorkspaceFile: (relativePath: string) => Promise<GetWorkspaceFileResult>;
	/** Bridge SaveWorkspaceFile — optional mtime (+ bytes) CAS. */
	saveWorkspaceFile: (
		relativePath: string,
		content: string,
		mtime?: number,
		bytes?: number
	) => Promise<SaveWorkspaceFileResult>;
	readMedia: (relativePath: string) => Promise<ReadMediaResult>;
	/** Absolute path of a pasted/dropped File ('' when synthetic — e.g. screenshot blob). */
	getPathForFile: (file: HostFileRef) => string;
	/** `projectId` may be folder OpenProject.id or Meta project id (Teams rows). */
	createTask: (title?: string, projectId?: string) => Promise<TaskSummary | null>;
	createChat: (title?: string) => Promise<TaskSummary | null>;
	getPetVisible: () => Promise<boolean>;
	setPetVisible: (visible: boolean) => Promise<boolean>;
	getSystemLocale: () => Promise<string>;
	setLocalePref: (pref: string) => Promise<boolean>;
	selectTask: (
		taskId: string,
		focusEpoch?: number
	) => Promise<(TaskSummary & {trace?: TaskSelectTrace}) | null>;
	/**
	 * Open Tab reconcile: Bind+Attach listed Tasks without changing focus.
	 * Close Tab does not Detach (option B).
	 */
	ensureTasksLive: (
		taskIds: string[]
	) => Promise<{ok: string[]; skipped: string[]}>;
	openLivingSession: (
		sessionId: string,
		metaProjectId?: string | null
	) => Promise<
		| {ok: true; taskId: string; title: string; kind?: string; sessionId?: string | null}
		| {ok: false; notice: string}
	>;
	renameTask: (taskId: string, title: string) => Promise<TaskMutationResult>;
	deleteTask: (taskId: string, sessionId?: string | null) => Promise<TaskMutationResult>;
	sendMessage: (
		text: string,
		mentions?: MentionChip[],
		expectedTaskId?: string | null
	) => Promise<SendMessageResult>;
	/** UI Build → PlanBuild (plan_build user + Build Dock). */
	buildPlan: (planId: string, name?: string) => Promise<SendMessageResult>;
	/** Bridge MentionSuggest — results arrive via onBridgeEvent(mention_suggestions). */
	mentionSuggest: (
		prefix: string,
		requestId: string,
		kinds?: string[]
	) => Promise<boolean>;
	listTasks: () => Promise<TasksSnapshot>;
	decideApproval: (approvalId: string, approved: boolean, reason?: string) => Promise<boolean>;
	/** ②′ Goal card actions — the only Goal gate surface. Optional goalId for LivingTask rail. */
	confirmGoal: (patchJson?: string) => Promise<boolean>;
	pauseGoal: (goalId?: string) => Promise<boolean>;
	cancelGoal: (goalId?: string) => Promise<boolean>;
	resumeGoal: (goalId?: string) => Promise<boolean>;
	steerGoal: (note: string, goalId?: string) => Promise<boolean>;
	escalateGoal: (action: 'resume' | 'fail') => Promise<boolean>;
	dismissGoalCard: () => Promise<boolean>;
	answerQuestion: (questionId: string, answer: string) => Promise<boolean>;
	answerQuestionBatch: (
		rpcId: string,
		payload: {answers: Array<{id: string; selected: string[]; custom?: string}>} | {cancelled: true}
	) => Promise<boolean>;
	cancelRun: (reason?: string) => Promise<boolean>;
	rerunRun: (runId: string) => Promise<boolean>;
	/** Stop a single Proc (KillProc). Wakes BackgroundWake with reason=user_stopped. */
	killProc: (procId: string, reason?: string, sessionId?: string) => Promise<boolean>;
	/** ADR-0012: fetch older Turns when Transcript is scrolled near the top. */
	requestOlderHistory: () => Promise<boolean>;
	requestModelList: () => Promise<boolean>;
	/** Refresh Skills for composer slash menu (Bridge `/skills` → commands_available). */
	requestSlashCatalog: () => Promise<boolean>;
	selectModel: (modelId: string) => Promise<boolean>;
	setRunMode: (mode: string, expectedTaskId?: string | null) => Promise<boolean>;
	setEngineKind: (kind: string, expectedTaskId?: string | null) => Promise<boolean>;
	setModelSettings: (settings: {
		platform: string;
		model: string;
		effort?: string;
		thinking?: boolean;
	}) => Promise<boolean>;
	removeQueueItem: (itemId: string) => Promise<boolean>;
	clearQueue: () => Promise<boolean>;
	reorderQueue: (fromIndex: number, toIndex: number) => Promise<boolean>;
	editQueueItem: (itemId: string, text: string) => Promise<boolean>;
	setQueuePaused: (paused: boolean) => Promise<boolean>;
	interruptQueueItem: (itemId: string) => Promise<boolean>;
	dshSteer: (text: string) => Promise<boolean>;
	dshGoalAct: (action: 'pause' | 'resume' | 'complete' | 'clear') => Promise<boolean>;
	retryEngine: () => Promise<boolean>;
	engineDiagnostics: () => Promise<{parseFailures: number; deadLetters: readonly string[]}>;
	checkRestoreState: () => Promise<{done: boolean; failed: boolean; reason?: string}>;
	onProjectsChanged: (handler: (payload: ProjectsSnapshot) => void) => () => void;
	onWorkspaceFocus: (handler: (payload: WorkspaceFocus) => void) => () => void;
	onProjectChanged: (handler: (payload: ProjectState) => void) => () => void;
	onTasksChanged: (handler: (payload: TasksMeta) => void) => () => void;
	onTranscriptPatched: (handler: (payload: TranscriptPatch) => void) => () => void;
	onTranscriptTailPatched: (handler: (payload: TranscriptTailPatch) => void) => () => void;
	onBridgeEvent: (handler: (payload: BridgeEventEnvelope) => void) => () => void;
	onBridgeError: (handler: (payload: BridgeErrorEnvelope) => void) => () => void;
	onWorkspaceRestored: (handler: () => void) => () => void;
	onWorkspaceRestoreFailed: (handler: (payload: {reason: string}) => void) => () => void;
	/** PatchSettings fan-out — invalidate settings UI cache for scope=global. */
	onSettingsChanged: (
		handler: (payload: {scope: string; scopeId: string; namespace: string}) => void
	) => () => void;
	/** Provider mutation fan-out — invalidate providers UI cache. */
	onProvidersChanged: (handler: (payload: {providerId: string}) => void) => () => void;
	/** Skill mutation fan-out — invalidate skills UI cache. */
	onSkillsChanged: (handler: (payload: {skillName: string}) => void) => () => void;
	/** Turn / Goal settled — play completion sound when the setting is on. */
	onCompletionCue: (handler: (payload: CompletionCue) => void) => () => void;
	getDshModels: (sessionId?: string) => Promise<DshModelsResult>;
	selectDshModel: (input: DshSelection & {sessionId?: string}) => Promise<DshCallResult>;
	listDshSkills: (sessionId: string) => Promise<DshSkillsResult>;
	dshSettings: DshSettingsApi;
	/** Narrow DSH unary escape hatch. First-party UI uses typed capabilities above. */
	dshCall: (
		method: string,
		payload?: Record<string, unknown>,
		sessionId?: string
	) => Promise<DshCallResult>;
};

export type DshSettingsApi = {
	describe: () => Promise<DshCallResult>;
	update: (input: {
		ns: string;
		patch: Record<string, unknown>;
		expectedRevision?: number;
	}) => Promise<DshCallResult>;
	mutate: (input: {
		ns: string;
		ops: DshSettingsPathOp[];
		expectedRevision?: number;
	}) => Promise<DshCallResult>;
	replace: (input: {
		ns: string;
		section: Record<string, unknown>;
		expectedRevision?: number;
	}) => Promise<DshCallResult>;
	openDocument: () => Promise<DshCallResult>;
	credentialsDescribe: (refs: string[]) => Promise<DshCallResult>;
	credentialsSet: (ref: string, value: string) => Promise<DshCallResult>;
	credentialsUnset: (ref: string) => Promise<DshCallResult>;
	llmModels: () => Promise<DshCallResult>;
	llmProviders: () => Promise<DshCallResult>;
	llmDiscoverModels: (input: Record<string, unknown>) => Promise<DshCallResult>;
	agentPresetList: () => Promise<DshCallResult>;
	agentPresetSelect: (sessionId: string, agentPreset: string) => Promise<DshCallResult>;
	agentPresetRead: (agentPreset: string) => Promise<DshCallResult>;
	agentPresetCopy: (input: {from: string; agentPreset: string; name?: string}) => Promise<DshCallResult>;
	agentPresetOpenDocument: (agentPreset: string) => Promise<DshCallResult>;
	agentPresetRemove: (agentPreset: string) => Promise<DshCallResult>;
	sessionList: () => Promise<DshCallResult>;
	pluginInventoryList: () => Promise<DshCallResult>;
};

export type {ProjectSnapshot, ModelCatalogEntry, MentionChip, QueueItem};
