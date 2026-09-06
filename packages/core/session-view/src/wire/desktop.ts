/**
 * Desktop-product wire DTOs — settings, edges, FS, engines, DSH settings.
 * Not referenced by session-view projections; invoke maps import them.
 */

export type {
	DiffHunk,
	FileReviewDiff,
	HunkLine,
	ReviewAnchor,
	ReviewChange,
	ReviewChangeDetail,
	ReviewChangeState,
	ReviewDiffSnapshot,
	ReviewKind,
	ReviewList,
	ReviewPreview,
	ReviewRefusal,
	ReviewRestored,
	ReviewSide
} from './review.js';

export type GitFileChangeKind = 'modified' | 'added' | 'deleted';

export type GitFileChange = {
	/** Project-relative path with `/` separators. */
	path: string;
	kind: GitFileChangeKind;
};

export type GitStatus = {
	branch: string;
	dirty: boolean;
	/** Working-tree / index changes for file-tree decorations. */
	files: GitFileChange[];
};

export type DirEntry = {
	name: string;
	kind: 'dir' | 'file';
	relativePath: string;
	mtime?: number | null;
};

/** Bridge editor FS failure codes (`command_result.fs.code`). */
export type WorkspaceFsCode =
	| 'outside'
	| 'too-large'
	| 'binary'
	| 'conflict'
	| 'missing'
	| 'no-slot'
	| 'busy'
	| 'is-dir'
	| 'not-found'
	| 'not-dir'
	| 'denied'
	| 'invalid'
	| 'exists';

export type HostDirCode =
	| 'not-found'
	| 'not-dir'
	| 'denied'
	| 'invalid'
	| 'exists'
	| 'unknown-command'
	| 'timeout';

export type HostDirEntry = {
	name: string;
	path: string;
	kind: 'dir' | 'file';
};

export type HostDirResult =
	| {
			ok: true;
			path: string;
			home: string;
			entries: HostDirEntry[];
			truncated?: boolean;
	  }
	| {
			ok: false;
			error: string;
			code?: HostDirCode;
			/** Old engine unknown-command — dialog should drop the tree. Timeout uses `code` only. */
			fallback?: boolean;
			home?: string;
			entries: [];
	  };

export type HostDirCreateResult =
	| {ok: true; path: string; home: string; name: string}
	| {ok: false; error: string; code?: HostDirCode; fallback?: boolean; home?: string};

export type EdgeCapabilities = {
	canOpenLocalFolder: boolean;
	canCreateLocalProject: boolean;
	canOpenRemoteFolder: boolean;
};

export type EdgePublic = {
	id: string;
	name: string;
	ip: string;
	port: number;
};

export type EdgesList = {
	activeId: string;
	pendingEdgeId?: string | null;
	servers: EdgePublic[];
	capabilities: EdgeCapabilities;
	hostHome?: string;
	runActive?: boolean;
};

export type EdgeDetail = EdgePublic & {
	token: string;
	fingerprint?: string;
	caPem?: string;
	insecureSkipVerify?: boolean;
};

export type EdgeUpsertInput = {
	id?: string;
	name: string;
	ip: string;
	port: number;
	token: string;
	fingerprint?: string;
	caPem?: string;
	insecureSkipVerify?: boolean;
};

export type EdgeTestInput = {
	ip: string;
	port: number;
	token: string;
	fingerprint?: string;
	caPem?: string;
	insecureSkipVerify?: boolean;
};

export type EdgeFailure = {
	ok: false;
	code: string;
	message: string;
	fingerprint?: string;
	display?: string;
};

export type EdgeOk = {ok: true; fingerprint?: string};

export type EdgeSelectResult = EdgeOk | EdgeFailure;
export type EdgeTestResult = EdgeOk | EdgeFailure;

/** Pairing export for the mobile app (S7.2): LAN WSS URL + token + cert fingerprint. */
export type MobilePairingInfo = {
	available: boolean;
	/** Desktop UI: engine down, local opt-in off, or no LAN wss. */
	reason?: 'engine' | 'off' | 'no_lan';
	host: string;
	port: number;
	/** `wss://<host>:<port>/bridge` */
	serverUrl: string;
	token: string;
	fingerprint: string;
	/** Engine error detail when a `SetLanPairing` switch command failed. */
	error?: string;
};
export type EdgeDeleteResult = EdgeOk | EdgeFailure;
export type EdgeUpsertResult = {ok: true; id: string} | EdgeFailure;

export type ListWorkspaceDirResult =
	| {
			ok: true;
			relativePath: string;
			entries: DirEntry[];
			/** Host capped the listing (default 5000); tree shows a hint. */
			truncated?: boolean;
	  }
	| {
			ok: false;
			error: string;
			code?: WorkspaceFsCode;
			entries: [];
	  };

/** @deprecated Prefer ListWorkspaceDirResult — alias kept for transitional imports. */
export type ListDirResult = ListWorkspaceDirResult;

export type GetWorkspaceFileResult =
	| {
			ok: true;
			relativePath: string;
			content: string;
			mtime: number;
			bytes?: number;
	  }
	| {
			ok: false;
			error: string;
			code?: WorkspaceFsCode;
	  };

/** @deprecated Prefer GetWorkspaceFileResult. */
export type ReadFileResult = GetWorkspaceFileResult;

export type SaveWorkspaceFileResult =
	| {
			ok: true;
			relativePath?: string;
			mtime: number;
			bytes: number;
	  }
	| {
			ok: false;
			error: string;
			code?: WorkspaceFsCode;
			/** Disk mtime cursor after conflict (must replace the tab's savedMtimeMs). */
			mtime?: number;
	  };

export type ReadMediaResult =
	| {
			ok: true;
			relativePath: string;
			mimeType: string;
			dataUrl: string;
	  }
	| {
			ok: false;
			error: string;
	  };

export type TeamRow = {
	id: string;
	name: string;
	kind: string;
	status: string;
	projectId: string;
	projectDisplayName?: string | null;
	workspaceId?: string | null;
	originGoalId?: string | null;
	verifierAgentId?: string | null;
	defaultWorkflowSpec?: string | null;
	description?: string | null;
	members?: Array<{name: string; teamRole: string; agentId: string}>;
	createdAt?: string | null;
};

/** Agents UI row — ListAgents / CreateAgent / UpdateAgent / GetAgent / CloneAgent / Archive*. */
export type AgentRow = {
	id: string;
	name: string;
	status: string;
	projectId: string;
	projectDisplayName?: string | null;
	teamId?: string | null;
	teamRole?: string | null;
	model?: string | null;
	taskBrief?: string | null;
	declarationJson?: string | null;
	latestRunId?: string | null;
	createdAt?: string | null;
};

export type AmbientRule = {
	id: string;
	scope: string;
	projectId?: string | null;
	text: string;
	enabled: boolean;
	createdAt?: string | null;
};

/** One settings namespace document (GetSettings / PatchSettings; settings-center-storage.md). */
export type SettingsDoc = {
	scope: string;
	scopeId: string;
	namespace: string;
	payload: unknown;
	schemaVersion: number;
	updatedAt?: string | null;
	/** Only on scope=effective reads: global | project | merged. */
	source?: string | null;
};

export type SettingsScope = 'global' | 'project' | 'effective';

/** Model row inside a provider's models_json (ListProviders DTO). */
export type ProviderModel = {
	modelId: string;
	displayName: string;
	aliases?: string[];
	supportsThinking?: boolean;
	supportedEfforts?: string[];
	defaultEffort?: string;
	maxTokens?: number;
	enabled: boolean;
	source: string;
};

/** Settings-center provider row — never includes ciphertext (List/Upsert/…Provider). */
export type ProviderRow = {
	id: string;
	kind: string;
	vendor: string;
	name: string;
	baseUrl?: string | null;
	status?: string | null;
	statusDetail?: string | null;
	last4?: string | null;
	modelCount: number;
	enabledModelCount: number;
	enabled: boolean;
	meta?: unknown;
	models?: ProviderModel[];
	updatedAt?: string | null;
};

/** OpenRouter (etc.) search candidate (SearchProviderModels). */
export type SearchModelRow = {
	modelId: string;
	displayName: string;
	contextLength?: number | null;
	vendorHint?: string | null;
};

/** UpsertProvider host args (presetKey seeds catalog; seedModels for custom). */
export type UpsertProviderInput = {
	name: string;
	id?: string;
	presetKey?: string;
	baseUrl?: string;
	kind?: string;
	metaJson?: string;
	credential?: string;
	seedModelsJson?: string;
};

/** PatchProviderModels op — enable / rename / add / remove. */
export type ProviderModelPatch = {
	op: 'enable' | 'rename' | 'add' | 'remove' | string;
	modelId: string;
	enabled?: boolean;
	displayName?: string;
	aliases?: string[];
	supportsThinking?: boolean;
	supportedEfforts?: string[];
	defaultEffort?: string;
};

/** Settings-center installed skill row (List/Create/SetSkillEnabled). */
export type SkillRow = {
	name: string;
	description: string;
	scope: string;
	source: string;
	marketId?: string | null;
	enabled: boolean;
	location?: string | null;
	dirName?: string | null;
};

/** Skills.sh market search row (SearchSkillMarket). */
export type MarketSkillRow = {
	id: string;
	skillId: string;
	name: string;
	source: string;
	installs: number;
	isInstalled: boolean;
	description?: string;
	author?: string;
};

/** CreateSkill host args. */
export type CreateSkillInput = {
	name: string;
	scope: string;
	template?: string;
};

export type EngineWireRow = {
	id: string;
	kind: 'builtin' | 'extension';
	adapter: 'ready' | 'disabled' | 'failed';
	program: 'builtin' | 'installed' | 'missing' | 'installing';
	process: 'none' | 'stopped' | 'running';
	processDetail?: string;
	isDefault: boolean;
	inRegistry: boolean;
	actions: string[];
	installLog?: Array<{stream: 'stdout' | 'stderr'; text: string; seq: number}>;
};

export type DshError = {
	code: string;
	message?: string;
	[key: string]: unknown;
};

export type DshCallResult =
	| {ok: true; method: string; value: unknown}
	| {ok: false; error: DshError};

export type DshSelection = {
	provider: string;
	model: string;
	reasoningEffort?: string;
};

export type DshModelGroup = {
	id: string;
	name: string;
	models: Array<{
		id: string;
		name: string;
		description?: string;
		reasoning?: {efforts: Array<{id: string; name: string; description?: string}>; defaultEffort?: string};
	}>;
};

export type DshModelFailure = {id: string; name: string; message: string};

export type DshModelsValue = {
	current: DshSelection;
	routable: boolean;
	groups: DshModelGroup[];
	failures: DshModelFailure[];
};

export type DshModelsResult = {ok: true; value: DshModelsValue} | {ok: false; error: DshError};

export type DshSettingsPathOp =
	| {op: 'set'; path: string[]; value: unknown}
	| {op: 'unset'; path: string[]};

/** Settings-page facade ops. Method names live only in `bridge/dsh/settings.ts`. */
export type DshSettingsOp =
	| {op: 'describe'}
	| {op: 'update'; ns: string; patch: Record<string, unknown>; expectedRevision?: number}
	| {op: 'mutate'; ns: string; ops: DshSettingsPathOp[]; expectedRevision?: number}
	| {op: 'replace'; ns: string; section: Record<string, unknown>; expectedRevision?: number}
	| {op: 'openDocument'}
	| {op: 'credentialsDescribe'; refs: string[]}
	| {op: 'credentialsSet'; ref: string; value: string}
	| {op: 'credentialsUnset'; ref: string}
	| {op: 'llmModels'}
	| {op: 'llmProviders'}
	| {op: 'llmDiscoverModels'; input: Record<string, unknown>}
	| {op: 'agentPresetList'}
	| {op: 'agentPresetSelect'; sessionId: string; agentPreset: string}
	| {op: 'agentPresetRead'; agentPreset: string}
	| {op: 'agentPresetCopy'; from: string; agentPreset: string; name?: string}
	| {op: 'agentPresetOpenDocument'; agentPreset: string}
	| {op: 'agentPresetRemove'; agentPreset: string}
	| {op: 'sessionList'}
	| {op: 'pluginInventoryList'};

