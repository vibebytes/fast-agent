import type {FastIdeApi} from '../../shared/fastIdeApi';

export type {FastIdeApi};

/** Re-export wire domain types for renderer modules that historically imported from `./env`. */
export type {
	BridgeErrorEnvelope,
	ChildTranscriptView,
	CodeChange,
	ComposerGate,
	ContextInjectionView,
	ContextPruneView,
	EngineHostStatus,
	GoalCardView,
	GoalFlowView,
	LiveChildWork,
	LiveProc,
	LiveTask,
	MentionChip,
	ModelCatalogEntry,
	PendingApproval,
	PendingQuestion,
	PendingQuestionBatch,
	TranscriptSubagent,
	ProjectGetResult,
	ProjectSnapshot,
	ProjectState,
	ProjectsSnapshot,
	QueueItem,
	DshCaps,
	DshQueueItem,
	DshGoalView,
	SlashCatalogEntry,
	TaskSummary,
	TasksMeta,
	TasksSnapshot,
	TranscriptEntry,
	TranscriptPatch,
	TranscriptTailPatch,
	UsageView,
	WorkspaceFocus
} from '@fast-ide/session-view';

declare global {
	interface Window {
		fastIde: FastIdeApi;
	}
}

export {};
