/**
 * Conversation invoke channels — task / chat / goal / queue / model / slash / dsh.
 */
import type {EngineCallResult, DshModelsResult, DshSelection, DshSettingsOp, EngineCallError} from './desktop.js';
import type {
	MentionChip,
	SendMessageResult,
	TaskMutationResult,
	TaskSelectTrace,
	TaskSummary,
	TasksSnapshot,
	SlashCatalogEntry
} from './session.js';

export type DshSkillsResult = {ok: true; value: SlashCatalogEntry[]} | {ok: false; error: EngineCallError};

export type InvokeSession = {
	'task:showProjectInFolder': {args: [taskId: string]; result: boolean};
	/** Files pane menu — reveal a workspace-relative entry in the OS file manager. */
	'task:create': {
		args: [title?: string, projectId?: string];
		result: TaskSummary | null;
	};
	'chat:create': {args: [title?: string]; result: TaskSummary | null};
	'task:select': {
		args: [taskId: string, focusEpoch?: number];
		result: (TaskSummary & {trace?: TaskSelectTrace}) | null;
	};
	/** Open Tab working-set Bind+Attach without changing focus (option B). */
	'task:ensureLive': {
		args: [taskIds: string[]];
		result: {ok: string[]; skipped: string[]};
	};
	/** LivingTask rail: focus open Project by Meta id + select by Engine sessionId. */
	'task:openLiving': {
		args: [sessionId: string, metaProjectId?: string | null];
		result:
			| {ok: true; taskId: string; title: string; kind?: string; sessionId?: string | null}
			| {ok: false; notice: string};
	};
	'task:rename': {args: [taskId: string, title: string]; result: TaskMutationResult};
	/** Soft-delete Session (`UpdateSessionStatus` deleted) or discard unbound create. */
	'task:delete': {
		args: [taskId: string, sessionId?: string | null];
		result: TaskMutationResult;
	};
	'task:send': {
		args: [text: string, mentions?: MentionChip[], expectedTaskId?: string | null];
		result: SendMessageResult;
	};
	/** UI Build → PlanBuild (plan_build user + Build Dock). */
	'task:buildPlan': {args: [planId: string, name?: string]; result: SendMessageResult};
	/** Debounced Mentions prefix suggest (Bridge MentionSuggest). */
	'mention:suggest': {
		args: [prefix: string, requestId: string, kinds?: string[]];
		result: boolean;
	};
	'task:list': {args: []; result: TasksSnapshot};
	'task:approve': {
		args: [approvalId: string, approved: boolean, reason?: string];
		result: boolean;
	};
	/** ②′ Goal card actions — the only Goal gate surface. Optional goalId for LivingTask rail. */
	'goal:confirm': {args: [patchJson?: string]; result: boolean};
	'goal:pause': {args: [goalId?: string]; result: boolean};
	'goal:cancel': {args: [goalId?: string]; result: boolean};
	'goal:resume': {args: [goalId?: string]; result: boolean};
	'goal:steer': {args: [note: string, goalId?: string]; result: boolean};
	'goal:escalate': {args: [action: 'resume' | 'fail']; result: boolean};
	'goal:dismiss': {args: []; result: boolean};
	'task:answer': {args: [questionId: string, answer: string]; result: boolean};
	'task:answerBatch': {
		args: [
			rpcId: string,
			payload: {answers: Array<{id: string; selected: string[]; custom?: string}>} | {cancelled: true}
		];
		result: boolean;
	};
	'task:cancel': {args: [reason?: string]; result: boolean};
	'task:rerun': {args: [runId: string]; result: boolean};
	'task:killProc': {args: [procId: string, reason?: string, sessionId?: string]; result: boolean};
	'task:requestOlderHistory': {args: []; result: boolean};
	'model:list': {args: []; result: boolean};
	'model:select': {args: [modelId: string]; result: boolean};
	'mode:set': {args: [mode: string, expectedTaskId?: string | null]; result: boolean};
	'engineKind:set': {args: [kind: string, expectedTaskId?: string | null]; result: boolean};
	'model:settings': {
		args: [
			settings: {
				platform: string;
				model: string;
				effort?: string;
				thinking?: boolean;
			}
		];
		result: boolean;
	};
	/** Refresh slash Skills via Bridge `/skills` (silent list → `commands_available`). */
	'slash:list': {args: []; result: boolean};
	'queue:remove': {args: [itemId: string]; result: boolean};
	'queue:clear': {args: []; result: boolean};
	'queue:reorder': {args: [fromIndex: number, toIndex: number]; result: boolean};
	'queue:edit': {args: [itemId: string, text: string]; result: boolean};
	'queue:pause': {args: [paused: boolean]; result: boolean};
	'queue:interrupt': {args: [itemId: string]; result: boolean};
	'dsh:steer': {args: [text: string]; result: boolean};
	'dshGoal:act': {args: [action: 'pause' | 'resume' | 'complete' | 'clear']; result: boolean};
	/** Generic DSH unary hop. Error keeps DSH `{ code, message, ... }`. */
	'dsh:call': {
		args: [method: string, payload?: Record<string, unknown>, sessionId?: string];
		result: EngineCallResult;
	};
	'dsh:models': {
		args: [sessionId?: string];
		result: DshModelsResult;
	};
	'dsh:selectModel': {
		args: [input: DshSelection & {sessionId?: string}];
		result: EngineCallResult;
	};
	'dsh:skills': {
		args: [sessionId: string];
		result: DshSkillsResult;
	};
	'dsh:settings': {
		args: [op: DshSettingsOp];
		result: EngineCallResult;
	};
};
