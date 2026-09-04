export {
	documentCard,
	forgetDocument,
	isChatAssistant,
	rememberDocument
} from './chatDocument.js';

export {
	emptySessionSeq,
	eventSeqOf,
	offer,
	seqTerminal,
	unitIdOf,
	type OfferCtx,
	type OfferResult,
	type SessionSeq
} from './sessionSeq.js';

export {
	appendProcPreview,
	applyBridgeEvent,
	applyLocalCancel,
	applyLeaseExpiry,
	createTranscriptState,
	LIVE_PROC_PREVIEW_MAX,
	nextFireAtFromDetail,
	oldestLoadedTurnId,
	type EntrySegment,
	type GoalFlowMember,
	type GoalFlowView,
	type LiveChildWork,
	type LiveProc,
	type LiveTask,
	type NetworkWaitState,
	type PendingApproval,
	type PendingQuestion,
	type PendingQuestionBatch,
	type TranscriptSubagent,
	type QuestionBatchItem,
	type QuestionBatchIntent,
	type QuestionBatchOption,
	type ToolCallView,
	type TranscriptEntry,
	type TranscriptState
} from './transcriptProjection.js';

export {
	fileOp,
	formatFileOpEn,
	formatThoughtChromeEn,
	networkWaitLabel,
	thoughtChromeFrom,
	type FileOp,
	type NetworkWait,
	type ThoughtChrome
} from './chrome.js';

export {
	CANCEL_SETTLEMENT_TIMEOUT_MS,
	RUN_LEASE_INTERVAL_MS,
	RUN_LEASE_TTL_MS,
	canAutoDequeue,
	canFlushQueuedInput,
	composerGate,
	composerGateFromRunFlags,
	type ComposerGate,
	type ComposerLockReason,
	type ComposerRunFlags,
	type RunState,
	type TurnTerminal
} from './composerGate.js';

export {
	shouldSoundOnSettle,
	type CompletionCueInput,
	type CompletionCueKind
} from './completionCue.js';

export {
	PROCESS_STACK_MIN_STEPS,
	toTimelineItems,
	projectEntryToTimelineItems,
	wrapProcessStacks,
	goalFlowInsertIndex,
	placeGoalFlow,
	staleErrorCardIds,
	regenUserIdOf,
	type ProcessStackStep,
	type TimelineItem,
	type TimelineOptions,
	type TimelineSource
} from './timeline.js';

/** @deprecated Production hosts: prefer createSessionViewProjector / projectSessionView. */
export {
	createTimelineProjectionCache,
	type TimelineProjectionCache
} from './timelineCache.js';

export {
	activeUserEntryIdForStop,
	createSessionViewProjector,
	projectSessionView,
	reviewFiles,
	type ProjectSessionViewOptions,
	type ReviewFile,
	type SessionViewCodeChange
} from './sessionView.js';

export {
	findLastSafeSplitPoint,
	splitStreamingMarkdown
} from './markdownSplit.js';

/** Perf harness (docs/features/message-flow-performance.md 刀 1) — test/bench use only. */
export {
	SYNTHETIC_DEFAULTS,
	syntheticOptionsFromEnv,
	syntheticSession,
	syntheticStreamingDelta,
	type SyntheticOptions
} from './perf/syntheticSession.js';

export {
	classifyToolActivity,
	countDiffStats,
	diffPreview,
	formatActivitySummary,
	isWriteTool,
	lineNumberFor,
	parseDiffWithLineNumbers,
	type ActivityCounts,
	type DiffLine
} from './diff.js';

export {
	buildApprovalViewModel,
	extractCommandFromToolCall,
	extractExternalDirectories,
	formatApprovalEn,
	formatApprovalReasonEn,
	formatApprovalTitleEn,
	formatRiskBadgeEn,
	formatShellIntentEn,
	formatSubjectLabelEn,
	riskBadge,
	shellApprovalIntent,
	shellIntent,
	shellRisk,
	type ApprovalReason,
	type ApprovalTitle,
	type ApprovalTitleHint,
	type ApprovalViewModel,
	type ApprovalViewModelEn,
	type RiskBadge,
	type ShellIntent,
	type ShellRisk,
	type SubjectLabel
} from './approvalDetails.js';

export {normalizeToolOutput, parseExitCode, resolveToolStatus, toolResultSuccessAttr} from './toolOutput.js';

export {
	mergePlanPatch,
	normalizeTodoStatus,
	normalizeTodos,
	parsePlanPayloadJson,
	planBuildDisplayContent,
	planBuildSubmitText,
	planFromWire,
	planTodoProgress,
	type PlanTodoStatus,
	type PlanTodoView,
	type PlanView
} from './plan.js';

export type {
	AgentRow,
	AmbientRule,
	CreateSkillInput,
	MarketSkillRow,
	ProviderModel,
	ProviderModelPatch,
	ProviderRow,
	SearchModelRow,
	SettingsDoc,
	SettingsScope,
	SkillRow,
	UpsertProviderInput,
	BridgeErrorEnvelope,
	BridgeEventEnvelope,
	BridgeExitEnvelope,
	BridgeLogEnvelope,
	CodeChange,
	CompletionCue,
	DirEntry,
	EngineHostStatus,
	EngineWireRow,
	GitFileChange,
	GitFileChangeKind,
	GitStatus,
	InvokeArgs,
	InvokeChannel,
	InvokeChannels,
	InvokeResult,
	ListDirResult,
	ListWorkspaceDirResult,
	GetWorkspaceFileResult,
	SaveWorkspaceFileResult,
	WorkspaceFsCode,
	HostDirCode,
	HostDirEntry,
	HostDirResult,
	HostDirCreateResult,
	EdgeCapabilities,
	EdgePublic,
	EdgesList,
	EdgeDetail,
	EdgeUpsertInput,
	EdgeTestInput,
	EdgeFailure,
	EdgeSelectResult,
	EdgeTestResult,
	EdgeDeleteResult,
	EdgeUpsertResult,
	MobilePairingInfo,
	ModelCatalogEntry,
	ProjectGetResult,
	ProjectSnapshot,
	ProjectState,
	ProjectStatus,
	ProjectsFocus,
	ProjectsSnapshot,
	PushChannel,
	PushChannels,
	MentionChip,
	QueueItem,
	DshCaps,
	DshQueueItem,
	DshGoalView,
	ReadFileResult,
	ReadMediaResult,
	ReviewAnchor,
	ReviewChange,
	ReviewChangeDetail,
	ReviewChangeState,
	DiffHunk,
	FileReviewDiff,
	HunkLine,
	ReviewDiffSnapshot,
	ReviewKind,
	ReviewList,
	ReviewPreview,
	ReviewRefusal,
	ReviewRestored,
	ReviewSide,
	SendMessageResult,
	SlashCatalogEntry,
	GoalCardView,
	TaskMutationResult,
	TaskSelectTrace,
	TaskSummary,
	TasksMeta,
	TasksSnapshot,
	TeamRow,
	TranscriptPatch,
	TranscriptTailPatch,
	UiSend,
	WorkspaceFocus,
	DshCallResult,
	DshError,
	DshSelection,
	DshModelGroup,
	DshModelFailure,
	DshModelsValue,
	DshModelsResult,
	DshSkillsResult,
	DshSettingsPathOp,
	DshSettingsOp
} from './wire.js';
