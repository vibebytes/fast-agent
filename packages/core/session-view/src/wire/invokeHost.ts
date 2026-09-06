/**
 * Desktop host invoke channels — project / fs / edges / settings / review / engines.
 */
import type {
	AmbientRule,
	CreateSkillInput,
	EdgeDeleteResult,
	EdgeDetail,
	EdgeSelectResult,
	EdgeTestInput,
	EdgeTestResult,
	EdgeUpsertInput,
	EdgeUpsertResult,
	EdgesList,
	EngineWireRow,
	GetWorkspaceFileResult,
	GitStatus,
	HostDirCreateResult,
	HostDirResult,
	ListWorkspaceDirResult,
	MarketSkillRow,
	MobilePairingInfo,
	ProviderModelPatch,
	ProviderRow,
	ReadMediaResult,
	SaveWorkspaceFileResult,
	SearchModelRow,
	SettingsDoc,
	SettingsScope,
	FileReviewDiff,
	ReviewChangeDetail,
	ReviewDiffSnapshot,
	ReviewList,
	ReviewPreview,
	ReviewRefusal,
	ReviewRestored,
	SkillRow,
	UpsertProviderInput
} from './desktop.js';
import type {ProjectGetResult, TaskMutationResult} from './session.js';

export type InvokeHost = {
	'workspace:checkRestore': {
		args: [];
		result: {done: boolean; failed: boolean; reason?: string};
	};
	'project:open': {args: []; result: string | null};
	'project:openRemote': {args: [path: string]; result: string | null};
	'project:createBlank': {args: [name?: string]; result: string | null};
	'project:get': {args: []; result: ProjectGetResult};
	'project:gitStatus': {args: [force?: boolean]; result: GitStatus | null};
	'project:focus': {args: [projectId: string]; result: boolean};
	'project:close': {args: [projectId: string]; result: boolean};
	'project:showInFolder': {args: [projectId: string]; result: boolean};
	'workspace:showInFolder': {args: [relativePath: string]; result: boolean};
	listWorkspaceDir: {args: [relativePath?: string]; result: ListWorkspaceDirResult};
	'host:listDir': {args: [path?: string]; result: HostDirResult};
	'host:createDir': {args: [parent: string, name: string]; result: HostDirCreateResult};
	'edges:list': {args: []; result: EdgesList};
	'edges:get': {args: [id: string]; result: EdgeDetail | null};
	'edges:upsert': {args: [input: EdgeUpsertInput]; result: EdgeUpsertResult};
	'edges:delete': {args: [id: string]; result: EdgeDeleteResult};
	'edges:select': {args: [id: string]; result: EdgeSelectResult};
	'edges:test': {args: [input: EdgeTestInput]; result: EdgeTestResult};
	/** Mobile bridge pairing export — LAN address + token for the phone to scan. */
	'mobile:pairingInfo': {args: []; result: MobilePairingInfo};
	/** Toggle LAN bridge listener at runtime on the active engine. */
	'mobile:setLanPairing': {args: [enabled: boolean]; result: MobilePairingInfo};
	getWorkspaceFile: {args: [relativePath: string]; result: GetWorkspaceFileResult};
	saveWorkspaceFile: {
		args: [relativePath: string, content: string, mtime?: number, bytes?: number];
		result: SaveWorkspaceFileResult;
	};
	'fs:readMedia': {args: [relativePath: string]; result: ReadMediaResult};
	'pet:getVisible': {args: []; result: boolean};
	'pet:setVisible': {args: [visible: boolean]; result: boolean};
	/** OS locale tag from Electron `app.getLocale()`. */
	'locale:getSystem': {args: []; result: string};
	/** Apply locale preference in main (tray / pet menus). */
	'locale:set': {args: [payload: {pref: string}]; result: boolean};
	/** Re-start Engine after restore failure or disconnect (in-shell Retry). */
	'engine:retry': {args: []; result: boolean};
	/** Unix dead-letter ring + parse failure counts for the About diagnostics copy. */
	'engine:diagnostics': {
		args: [];
		result: {parseFailures: number; deadLetters: readonly string[]};
	};
	/** Persist Project display name via Bridge SetProjectDisplayName. */
	'project:rename': {args: [projectId: string, displayName: string]; result: TaskMutationResult};
	/** Ambient Rules (Meta) for Context pane. */
	'rules:list': {
		args: [projectId: string];
		result: {ok: true; rules: AmbientRule[]; replace: true} | {ok: false; notice: string};
	};
	'rules:add': {
		args: [projectId: string, text: string];
		result:
			| {ok: true; rules: AmbientRule[]; replace: boolean}
			| {ok: false; notice: string};
	};
	'rules:remove': {
		args: [projectId: string, ruleId: string];
		result: TaskMutationResult;
	};
	/** Settings-center documents (Engine DB via Bridge). */
	'settings:get': {
		args: [scope: SettingsScope, scopeId?: string];
		result: {ok: true; settings: SettingsDoc[]} | {ok: false; notice: string};
	};
	'settings:patch': {
		args: [scope: 'global' | 'project', namespace: string, patch: unknown, scopeId?: string];
		result: {ok: true; setting: SettingsDoc} | {ok: false; notice: string};
	};
	/** Settings-center model providers (Engine Meta via Bridge). */
	'providers:list': {
		args: [];
		result: {ok: true; providers: ProviderRow[]} | {ok: false; notice: string};
	};
	'providers:upsert': {
		args: [input: UpsertProviderInput];
		result: {ok: true; provider: ProviderRow} | {ok: false; notice: string};
	};
	'providers:delete': {
		args: [id: string];
		result: {ok: true} | {ok: false; notice: string};
	};
	'providers:setEnabled': {
		args: [id: string, enabled: boolean];
		result: {ok: true; provider: ProviderRow} | {ok: false; notice: string};
	};
	'providers:test': {
		args: [id: string];
		result: {ok: true; provider: ProviderRow} | {ok: false; notice: string};
	};
	'providers:patchModels': {
		args: [id: string, patch: ProviderModelPatch[]];
		result: {ok: true; provider: ProviderRow} | {ok: false; notice: string};
	};
	'providers:searchModels': {
		args: [id: string, query: string];
		result: {ok: true; searchModels: SearchModelRow[]} | {ok: false; notice: string};
	};
	/** Settings-center skills (disk SoT + Skills.sh market via Bridge). */
	'skills:list': {
		args: [];
		result: {ok: true; skills: SkillRow[]} | {ok: false; notice: string};
	};
	'skills:create': {
		args: [input: CreateSkillInput];
		result: {ok: true; skill: SkillRow} | {ok: false; notice: string};
	};
	'skills:delete': {
		args: [name: string, scope: string];
		result: {ok: true} | {ok: false; notice: string};
	};
	'skills:setEnabled': {
		args: [name: string, scope: string, enabled: boolean];
		result: {ok: true; skill: SkillRow} | {ok: false; notice: string};
	};
	'skills:searchMarket': {
		args: [query: string];
		result:
			| {ok: true; marketSkills: MarketSkillRow[]; message?: string}
			| {ok: false; notice: string};
	};
	'skills:installMarket': {
		args: [source: string, scope: string];
		result: {ok: true} | {ok: false; notice: string};
	};
	'skills:uninstallMarket': {
		args: [name: string, scope: string];
		result: {ok: true} | {ok: false; notice: string};
	};
	/** Extension admin (settings write; host principal). */
	'extensions:list': {
		args: [];
		result:
			| {
					ok: true;
					extensions: Array<{
						id: string;
						phase: 'Installed' | 'Active' | 'Stopping' | 'Uninstalled' | 'Failed';
						hotUnload: boolean;
						fault?: string;
						restartHint?: string;
					}>;
					ledger: Array<{id: string; mark: string}>;
			  }
			| {ok: false; notice: string};
	};
	'extensions:status': {
		args: [id: string];
		result:
			| {
					ok: true;
					extension: {
						id: string;
						phase: 'Installed' | 'Active' | 'Stopping' | 'Uninstalled' | 'Failed';
						hotUnload: boolean;
						fault?: string;
						restartHint?: string;
					} | null;
			  }
			| {ok: false; notice: string};
	};
	'extensions:install': {
		args: [dir: string];
		result: {ok: true; id: string} | {ok: false; notice: string};
	};
	'extensions:uninstall': {
		args: [id: string];
		result: {ok: true} | {ok: false; notice: string};
	};
	'extensions:pickDir': {
		args: [];
		result: string | null;
	};
	'engines:list': {
		args: [];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:enable': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:disable': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:start': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:stop': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:setDefault': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:install': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:uninstall': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'engines:cancelInstall': {
		args: [id: string];
		result: {ok: true; engines: EngineWireRow[]} | {ok: false; notice: string};
	};
	'rules:setEnabled': {
		args: [projectId: string, ruleId: string, enabled: boolean];
		result: TaskMutationResult;
	};
	/**
	 * Agent change review for one Project's checkout. Every channel names the Project rather than a
	 * path, so the renderer cannot ask the daemon to write outside it.
	 */
	'review:list': {
		args: [projectId: string, checkpointId?: string | null, sessionId?: string | null];
		result: {ok: true; list: ReviewList} | ReviewRefusal;
	};
	/** File contents for one row — kept off the list so blobs load only for the file being viewed. */
	'review:change': {
		args: [projectId: string, changeId: string];
		result: {ok: true; change: ReviewChangeDetail} | ReviewRefusal;
	};
	/**
	 * The whole pending agent effect in one answer: per path, hunks of first.before → last.after.
	 * One round trip replaces the per-row detail storm the card stream used to make.
	 */
	'review:diff': {
		args: [projectId: string, sinceRevision?: number];
		result: {ok: true; diff: ReviewDiffSnapshot} | ReviewRefusal;
	};
	/**
	 * One path's net effect with the batch hunk-line cap lifted (too-many-changes fallback).
	 * The path selects among this checkout's undecided review rows.
	 */
	'review:fileDiff': {
		args: [projectId: string, path: string];
		result: {ok: true; file: FileReviewDiff} | ReviewRefusal;
	};
	/** Accept the agent's edits. `revision` is the list the user decided against. */
	'review:keep': {
		args: [projectId: string, changeIds: string[], revision: number];
		result: {ok: true} | ReviewRefusal;
	};
	/** Plan an undo. Writes nothing, so it is safe to call to populate a confirmation. */
	'review:preview': {
		args: [
			projectId: string,
			input: {
				target: 'timeline' | 'whole' | 'pending' | 'changes';
				revision: number;
				checkpointId?: string;
				changeIds?: string[];
			}
		];
		result: {ok: true; preview: ReviewPreview} | ReviewRefusal;
	};
	/** Write a plan. `force` overwrites exactly the paths the preview listed in `forcePaths`. */
	'review:apply': {
		args: [projectId: string, previewId: string, force?: boolean];
		result: {ok: true; restored: ReviewRestored} | ReviewRefusal;
	};
	/** Put back what an undo took away. */
	'review:redo': {
		args: [projectId: string, restoreId: string];
		result: {ok: true; restored: ReviewRestored} | ReviewRefusal;
	};
};
