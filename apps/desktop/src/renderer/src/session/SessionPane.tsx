import {
	memo,
	Profiler,
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type ProfilerOnRenderCallback,
	type ReactNode
} from 'react';
import {compactionNotice, usageFooter, type TimelineItem} from '@fast-ide/session-view';
import {Alert, AlertDescription, AlertTitle} from '@fast-ide/ui/components/alert';
import {cn} from '@fast-ide/ui/lib/utils';
import {CircleAlert} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {
	ComposerGate,
	ModelCatalogEntry,
	QueueItem,
	DshCaps,
	DshQueueItem,
	DshGoalView,
	SlashCatalogEntry
} from '../env';
import {DialogueComposer} from '../DialogueComposer';
import {noteDshError} from '../dsh/composer/models';
import {bodyNeedsPull, type WorkspaceStore} from '../workspaceStore';
import {pullTaskBodies} from '../workspaceWire';
import {VirtualTranscript} from '../VirtualTranscript';
import type {StripItem} from '../openSet';
import {OpenTabStrip} from './OpenTabStrip';
import {basename} from './path';
import {EmptyConversationState} from './EmptyConversationState';
import {type QueueEcho} from './queueEcho';
import {stashOnSwitch, type KeepAliveEntry} from './transcriptKeepAlive';
import type {AgentReview} from '../review/useAgentReview';
import {UndoConfirm} from '../review/UndoConfirm';
import {deferredValueForTask} from './timelineDerived';
import {usePaneEffects} from './paneEffects';
import {markTabBodyPull, markTabProfile} from '../performanceTrace';

/** Trace-only commit attribution; sub-ms commits are filtered inside. */
const profileCommit: ProfilerOnRenderCallback = (id, phase, actualDuration) => {
	markTabProfile({subtree: id, phase, actualMs: actualDuration});
};

/** Rerun opener / rejection must land within this window or the optimistic hide rolls back. */
const REGEN_PENDING_TIMEOUT_MS = 30_000;

const StableOpenTabStrip = memo(OpenTabStrip);

/** Frozen render props of one transcript pane (keep-alive stash payload). */
type TranscriptPane = {
	items: TimelineItem[];
	scrollKey: string;
	taskId: string | null;
	bodyLoading: boolean;
	stick: {current: boolean};
	header: ReactNode;
	renderItem: (item: TimelineItem) => ReactNode;
};

export type SessionPaneProps = {
	store: WorkspaceStore;
	gate: ComposerGate;
	queue: QueueItem[];
	queuePaused?: boolean;
	dshCaps?: DshCaps;
	dshQueue?: DshQueueItem[];
	dshGoal?: DshGoalView | null;
	model: string;
	modelDisplay: string;
	modelCatalog: ModelCatalogEntry[];
	runMode?: 'agent' | 'plan' | 'ask' | 'yolo';
	engineKind?: 'fast' | 'dsh';
	availableEngineIds?: string[];
	effort?: string;
	thinking?: boolean;
	slashCatalog?: SlashCatalogEntry[];
	slashCatalogHydrated?: boolean;
	activeTaskId: string | null;
	/** Surface: workspace / task readiness for empty states + Composer. */
	canChat: boolean;
	hasProject: boolean;
	projectReady: boolean;
	hasActiveTask: boolean;
	projectError: string | null;
	/** Open Tab / Tab Group strip items (replaces single-title TitleBar). */
	openTabItems: StripItem[];
	/** Optimistic pressed tab (点击即亮) — highlights before the pane switch. */
	pressedTabId?: string | null;
	taskRunStates: Record<string, 'running' | 'completed-unseen'>;
	groupLabels: Record<string, string>;
	rightRailOpen: boolean;
	onActivateOpenTab: (tabId: string) => void;
	onCloseOpenTab: (tabId: string) => void;
	onToggleTabGroup: (groupKey: string) => void;
	onExpandRightRail: () => void;
	onOpenFile: (path: string, line?: number, endLine?: number) => void;
	/** Insert @mention chip from Teams workbench after returning to task. */
	pendingMentionInsert?: {
		ref: string;
		label: string;
		description: string;
		kind: string;
		locator: string;
	} | null;
	onPendingMentionConsumed?: () => void;
	pendingSlashInsert?: {
		name: string;
		label: string;
		description: string;
		kind: 'command' | 'skill';
	} | null;
	onPendingSlashConsumed?: () => void;
	onOpenTeams?: (req: {tab?: 'teams' | 'agents' | 'goals'; goalId?: string; teamId?: string; agentId?: string}) => void;
	/** Agent change review for the open Project — owned by App, since it is per checkout. */
	review: AgentReview;
	/** Opens one change as a diff tab in the right rail. */
	onOpenReviewDiff?: (changeId: string, path: string) => void;
};

/**
 * Session Pane — middle-column Session surface: Open Tab strip + Transcript + Composer.
 * Owns Session View projection, Review strip, queue/background chrome, and Esc cancel.
 */
export const SessionPane = memo(function SessionPane({
	store,
	gate,
	queue,
	queuePaused = false,
	dshCaps,
	dshQueue = [],
	dshGoal = null,
	model,
	modelDisplay,
	modelCatalog,
	runMode = 'agent',
	engineKind = 'fast',
	availableEngineIds = ['fast'],
	effort,
	thinking,
	slashCatalog = [],
	slashCatalogHydrated = false,
	activeTaskId,
	canChat,
	hasProject,
	projectReady,
	hasActiveTask,
	projectError,
	openTabItems,
	pressedTabId = null,
	taskRunStates,
	groupLabels,
	rightRailOpen,
	onActivateOpenTab,
	onCloseOpenTab,
	onToggleTabGroup,
	onExpandRightRail,
	onOpenFile,
	pendingMentionInsert,
	onPendingMentionConsumed,
	pendingSlashInsert,
	onPendingSlashConsumed,
	onOpenTeams,
	review,
	onOpenReviewDiff
}: SessionPaneProps) {
	const {t} = useTranslation();
	const subscribeTranscript = useCallback(
		(listener: () => void) => store.subscribeTranscript(activeTaskId, listener),
		[store, activeTaskId]
	);
	const getTranscript = useCallback(
		() => store.getTranscript(activeTaskId),
		[store, activeTaskId]
	);
	const currentTranscript = useSyncExternalStore(
		subscribeTranscript,
		getTranscript,
		getTranscript
	);
	// Keep typing/clicks urgent within one Task, but never carry a deferred
	// Transcript across focus (that flashes/prunes data under the wrong Task id).
	const currentFrame = useMemo(
		() => ({taskId: activeTaskId, value: currentTranscript}),
		[activeTaskId, currentTranscript]
	);
	const deferredFrame = useDeferredValue(currentFrame);
	// 流式 token（同一 entry 数、同 task）同步渲染，跳过 deferred 延迟；
	// 结构变化（新 entry、切换 task）仍走 deferred 避免 jank。
	const prevEntryCountRef = useRef(0);
	const entryCount = currentTranscript.entries.length;
	const isStreamingToken =
		deferredFrame.taskId === activeTaskId &&
		entryCount === prevEntryCountRef.current &&
		entryCount > 0;
	prevEntryCountRef.current = entryCount;
	const transcript = isStreamingToken
		? currentTranscript
		: deferredValueForTask(activeTaskId, currentTranscript, deferredFrame);
	// DSH delta surfaces: last-run token/cost footer + context-prune banner.
	const usageFooterView = useMemo(
		() => usageFooter(transcript, dshCaps?.delta),
		[transcript, dshCaps]
	);
	const pruneNotice = useMemo(
		() => compactionNotice(transcript, dshCaps?.delta),
		[transcript, dshCaps]
	);
	const [errorLine, setErrorLine] = useState<string | null>(null);
	// D10 regenerate: optimistic live hide of the victim answer while the
	// re-run streams. turn_started.supersedes records provenance live; a
	// RerunRun rejection (bridge:error with a rerun.* code) rolls the hide
	// back and the sticky banner explains why.
	const [regenPending, setRegenPending] = useState<{taskId: string; runId: string} | null>(null);
	const [regenRejected, setRegenRejected] = useState<{taskId: string | null; code: string} | null>(
		null
	);
	const bridgeError = useSyncExternalStore(
		store.subscribe,
		() => store.getState().bridgeError,
		() => store.getState().bridgeError
	);
	// regenPending is sticky through the whole re-run; once restore lands the
	// supersedes record, markers take over hiding and the optimistic state retires.
	useEffect(() => {
		if (
			regenPending &&
			regenPending.taskId === activeTaskId &&
			transcript.superseded?.[regenPending.runId]
		) {
			setRegenPending(null);
		}
	}, [regenPending, activeTaskId, transcript]);
	// Dead-man switch: if neither the rerun opener (superseded record) nor a rerun.*
	// rejection lands, roll the optimistic hide back instead of greying Retry forever.
	useEffect(() => {
		if (!regenPending) return;
		const pending = regenPending;
		const timer = window.setTimeout(() => {
			setRegenPending(current => {
				if (current !== pending) return current;
				setRegenRejected({taskId: pending.taskId, code: 'rerun.timeout'});
				return null;
			});
		}, REGEN_PENDING_TIMEOUT_MS);
		return () => window.clearTimeout(timer);
	}, [regenPending]);
	// Keep-alive: each pane owns its stick-to-bottom flag; shared across visits.
	const stickRefs = useRef(new Map<string, {current: boolean}>());
	const stickFor = useCallback((id: string | null) => {
		const key = id ?? '__none__';
		let ref = stickRefs.current.get(key);
		if (!ref) {
			ref = {current: true};
			stickRefs.current.set(key, ref);
		}
		return ref;
	}, []);
	const stickToBottomRef = stickFor(activeTaskId);
	// Frozen panes of recently left Tasks (render-phase adjust: the leaving pane
	// must stay mounted in the very same commit that renders the new active one).
	const stashRef = useRef<KeepAliveEntry<TranscriptPane>[]>([]);
	const lastLiveRef = useRef<KeepAliveEntry<TranscriptPane> | null>(null);
	const prevActiveRef = useRef<string | null | undefined>(undefined);
	if (prevActiveRef.current !== undefined && prevActiveRef.current !== activeTaskId) {
		stashRef.current = stashOnSwitch(
			stashRef.current,
			lastLiveRef.current?.taskId === prevActiveRef.current ? lastLiveRef.current : null,
			activeTaskId
		);
	}
	prevActiveRef.current = activeTaskId;
	/** Optimistic user echo (perf doc P2-15 / 5.1) — local only, never enters the store.
	 *  Retires when the engine's user row lands or the active task changes — no TTL. */
	const [echo, setEcho] = useState<QueueEcho | null>(null);
	const pulledBodyFor = useRef<string | null>(null);
	const activeTaskRef = useRef(activeTaskId);
	activeTaskRef.current = activeTaskId;
	// Latest projected timeline, readable from stable callbacks (submit/interrupt)
	// without adding `timeline` to their deps — the baseline for echo reflection.
	const timelineRef = useRef<readonly TimelineItem[]>([]);

	useEffect(() => {
		setErrorLine(null);
	}, [activeTaskId]);

	// A rerun rejection belongs to the conversation it was clicked in; scoping
	// by task keeps the banner from leaking into every other transcript.
	useEffect(() => {
		if (bridgeError?.code?.startsWith('rerun.')) {
			setRegenPending(null);
			setRegenRejected({taskId: activeTaskRef.current, code: bridgeError.code});
		}
	}, [bridgeError]);

	useEffect(() => {
		if (engineKind !== 'dsh') return;
		const last = [...transcript.entries].reverse().find(e => e.status === 'error');
		const text = last?.text?.trim();
		if (text === 'MISSING_CREDENTIAL' || text?.includes('MISSING_CREDENTIAL')) {
			noteDshError({code: 'MISSING_CREDENTIAL', message: text});
		}
	}, [engineKind, transcript.entries]);

	// Slim focus may omit a cold Task body. This subscription owner performs the
	// one-shot pull now that App no longer observes transcript storage.
	const workspace = store.getState();
	const sessionId =
		[...workspace.tasks, ...workspace.chats, ...workspace.defaultTasks].find(t => t.id === activeTaskId)
			?.sessionId ?? undefined;
	const focusedBodyRevision = workspace.activeBodyRevision;
	const bodyMissing = bodyNeedsPull(workspace, activeTaskId);
	// A cold pull can flip `bodyMissing` before React releases its deferred body.
	// Keep staging in waiting until the exact body being rendered is current.
	const transcriptBodyLoading = bodyMissing || transcript !== currentTranscript;
	const bodyPullKey = activeTaskId
		? `${activeTaskId}:${focusedBodyRevision ?? 'cold'}`
		: null;
	useEffect(() => {
		if (!activeTaskId || !bodyMissing || !bodyPullKey || pulledBodyFor.current === bodyPullKey) {
			return;
		}
		pulledBodyFor.current = bodyPullKey;
		const pullT0 = performance.now();
		markTabBodyPull({taskId: activeTaskId, phase: 'start'});
		void pullTaskBodies(store, activeTaskId)
			.then(() => {
				markTabBodyPull({
					taskId: activeTaskId,
					phase: 'end',
					durationMs: Number((performance.now() - pullT0).toFixed(1)),
					ok: true
				});
			})
			.catch(error => {
				if (pulledBodyFor.current === bodyPullKey) pulledBodyFor.current = null;
				const detail = error instanceof Error ? error.message : String(error);
				console.error('cold Transcript pull failed', error);
				markTabBodyPull({
					taskId: activeTaskId,
					phase: 'end',
					durationMs: Number((performance.now() - pullT0).toFixed(1)),
					ok: false
				});
				if (activeTaskRef.current === activeTaskId) {
					setErrorLine(t('errors.transcript.load_failed', {detail}));
				}
			});
	}, [activeTaskId, bodyMissing, bodyPullKey, store, t]);

	const {
		displayTimeline,
		scrollKey,
		hasThread,
		renderItem,
		onStopPlanBuild,
		onNearTop,
		composerStack,
		hasComposerStack,
		composerStop,
		onSubmitSuccess,
		onComposerError,
		timelineUndo,
		restoreFiles,
		setRestoreFiles
	} = usePaneEffects({
		gate,
		activeTaskId,
		transcript,
		regenPending,
		setRegenPending,
		setRegenRejected,
		echo,
		setEcho,
		setErrorLine,
		stickToBottomRef,
		timelineRef,
		activeTaskRef,
		onOpenFile,
		engineKind,
		store,
		dshCaps,
		review,
		onOpenReviewDiff,
		onOpenTeams,
		queue,
		queuePaused,
		dshQueue,
		dshGoal,
		currentTranscript,
		bodyMissing
	});



	const currentProject = useSyncExternalStore(
		store.subscribe,
		() => store.getState().project,
		() => store.getState().project
	);
	const projects = useSyncExternalStore(
		store.subscribe,
		() => store.getState().projects,
		() => store.getState().projects
	);
	const projectName =
		currentProject?.displayName ||
		(currentProject?.path ? basename(currentProject.path) : null);

	const isBlankSession =
		!hasProject ||
		(!hasThread && canChat) ||
		(!hasActiveTask && projectReady);

	const transcriptHeader = (
		<div role="log" aria-live="polite" className="contents">
			{pruneNotice ? (
				<div
					data-slot="context-prune-notice"
					data-phase={pruneNotice.phase}
					className="mb-4 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
				>
					{pruneNotice.phase === 'running' ? (
						<span
							aria-hidden
							className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
						/>
					) : null}
					<span>{pruneNotice.text}</span>
					{pruneNotice.phase === 'done' && pruneNotice.durationMs !== undefined ? (
						<span className="ml-auto tabular-nums opacity-70">{Math.round(pruneNotice.durationMs / 1000)}s</span>
					) : null}
				</div>
			) : null}
			{regenRejected && regenRejected.taskId === activeTaskId ? (
				<Alert variant="destructive" className="mb-4">
					<CircleAlert />
					<AlertTitle>{t('errors.rerun.bannerTitle')}</AlertTitle>
					<AlertDescription>
						{t(`errors.${regenRejected.code}`, {defaultValue: t('errors.rerun.rejected')})}
					</AlertDescription>
				</Alert>
			) : null}
			{(projectError || errorLine) && (
				<Alert variant="destructive" className="mb-4">
					<CircleAlert />
					<AlertTitle>Something went wrong</AlertTitle>
					<AlertDescription>{projectError ?? errorLine}</AlertDescription>
				</Alert>
			)}
			{isBlankSession && (
				<EmptyConversationState
					hasProject={hasProject}
					projectReady={projectReady}
					currentProject={currentProject}
					projects={projects}
					projectName={projectName}
					hasActiveTask={hasActiveTask}
					canChat={canChat}
				/>
			)}
		</div>
	);

	// Live pane + frozen keep-alive panes render as keyed siblings: switching
	// A→B keeps A's instance (key A) mounted-but-hidden, so A→B→A skips the
	// whole re-mount — React sees the same instance with identical frozen props.
	const livePane: TranscriptPane = {
		items: displayTimeline,
		scrollKey,
		taskId: activeTaskId,
		bodyLoading: transcriptBodyLoading,
		stick: stickToBottomRef,
		header: transcriptHeader,
		renderItem
	};
	lastLiveRef.current = activeTaskId ? {taskId: activeTaskId, pane: livePane} : null;
	const transcriptPanes = [
		...stashRef.current.map(e => ({key: e.taskId, pane: e.pane, visible: false})),
		{key: activeTaskId ?? '__none__', pane: livePane, visible: true}
	];

	return (
		<section className="flex h-full min-w-0 flex-col overflow-x-hidden">
			<StableOpenTabStrip
				items={openTabItems}
				activeTabId={pressedTabId ?? activeTaskId}
				taskRunStates={taskRunStates}
				groupLabels={groupLabels}
				rightRailOpen={rightRailOpen}
				onActivate={onActivateOpenTab}
				onClose={onCloseOpenTab}
				onToggleGroup={onToggleTabGroup}
				onExpandRightRail={onExpandRightRail}
			/>

			<Profiler id="transcript-panes" onRender={profileCommit}>
				{transcriptPanes.map(p => (
					<VirtualTranscript
						key={p.key}
						items={p.pane.items}
						scrollKey={p.pane.scrollKey}
						activeTaskId={p.pane.taskId}
						bodyLoading={p.pane.bodyLoading}
						stickToBottomRef={p.pane.stick}
						onStopPlanBuild={onStopPlanBuild}
						onNearTop={onNearTop}
						visible={p.visible}
						header={p.pane.header}
						renderItem={p.pane.renderItem}
					/>
				))}
			</Profiler>

			{/* Goal chrome = BackgroundTools drawer only (no confirm / running card). */}

			<Profiler id="composer" onRender={profileCommit}>
				<div className="shrink-0 px-4 pb-4 pt-2">
					{usageFooterView ? (
						<div
							data-slot="session-usage-footer"
							className="mb-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 pr-1 text-[11px] text-muted-foreground"
						>
							{usageFooterView.buckets.map(bucket => (
								<span key={bucket.key}>
									{bucket.key} {bucket.value.toLocaleString()}
								</span>
							))}
							{usageFooterView.raw
								? Object.entries(usageFooterView.raw).map(([key, value]) => (
										<span key={key}>
											{key} {value}
										</span>
									))
								: null}
						</div>
					) : null}
					<div
						data-slot="composer-surface"
					className={cn(
						'relative rounded-3xl border border-border/70 bg-background shadow-xs',
						'transition-all duration-200 ease-out',
						'focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 focus-within:shadow-md'
					)}
				>
					{hasComposerStack ? composerStack : null}
					<DialogueComposer
						key={activeTaskId}
						taskId={activeTaskId}
						hasDrawerAbove={hasComposerStack}
						canChat={canChat}
						composerLocked={gate.composerLocked}
						stopKind={composerStop}
						canSubmitNow={gate.canSubmitNow}
						canEnqueue={gate.canEnqueue}
						canSteer={dshCaps?.queue === true}
						model={model}
						modelDisplay={modelDisplay}
						modelCatalog={modelCatalog}
						stickyRunMode={runMode}
						stickyEngineKind={engineKind}
						availableEngineIds={availableEngineIds}
						stickyEffort={effort}
						stickyThinking={thinking}
						slashCatalog={slashCatalog}
						slashCatalogHydrated={slashCatalogHydrated}
						pendingMentionInsert={pendingMentionInsert}
						onPendingMentionConsumed={onPendingMentionConsumed}
						pendingSlashInsert={pendingSlashInsert}
						onPendingSlashConsumed={onPendingSlashConsumed}
						onSubmitSuccess={onSubmitSuccess}
						onError={onComposerError}
						sessionId={sessionId}
					/>
				</div>
			</div>
			</Profiler>

			{timelineUndo.plan ? (
				<UndoConfirm
					preview={timelineUndo.plan}
					busy={review.busy}
					scope={{
						files: restoreFiles,
						conversation: false,
						// Soft conversation rollback is not built yet, and a checkbox that pretended
						// otherwise would send the user back to a half-restored moment believing the
						// messages went with the files.
						conversationBlocked:
							'Rewinding the messages is not available yet — only the files go back.',
						onFiles: setRestoreFiles,
						onConversation: () => {}
					}}
					onCancel={timelineUndo.cancel}
					onConfirm={timelineUndo.confirm}
				/>
			) : null}
		</section>
	);
});
