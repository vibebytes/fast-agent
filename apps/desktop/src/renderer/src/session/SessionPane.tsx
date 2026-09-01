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
import {
	createSessionViewProjector,
	placeGoalFlow,
	regenUserIdOf,
	reviewFiles,
	staleErrorCardIds,
	type TimelineItem
} from '@fast-ide/session-view';
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
import {bodyNeedsPull, type TranscriptSlice, type WorkspaceStore} from '../workspaceStore';
import {pullTaskBodies} from '../workspaceWire';
import {VirtualTranscript} from '../VirtualTranscript';
import type {StripItem} from '../openSet';
import {BackgroundToolsSection} from './BackgroundTools';
import {drawerChildWork} from './backgroundTasks';
import {OpenTabStrip} from './OpenTabStrip';
import {pruneDecisions} from './pendingDecisions';
import {basename, dayGreeting} from './path';
import {EmptyConversationState} from './EmptyConversationState';
import {QueuedMessagesSection} from './QueuedMessages';
import {isEchoReflected, makeQueueEcho, type QueueEcho} from './queueEcho';
import {QueueDock} from '../dsh/queue/QueueDock';
import {GoalIsland} from '../dsh/goal/GoalIsland';
import {reviewListForSession} from '../review/agentReview';
import {stashOnSwitch, type KeepAliveEntry} from './transcriptKeepAlive';
import type {AgentReview} from '../review/useAgentReview';
import {UndoConfirm} from '../review/UndoConfirm';
import {useUndoFlow} from '../review/useUndoFlow';
import {ReviewChangesStrip} from './ReviewChangesStrip';
import {
	deferredValueForTask,
	stablePlanBuildIds,
	stableReviewFiles,
	transcriptScrollKey
} from './timelineDerived';
import {TimelineRow} from './TimelineRow';
import {
	activeTabFocusTaskId,
	markTabBodyPull,
	markTabPaint,
	markTabProfile,
	markTabRender
} from '../performanceTrace';

/** Trace-only commit attribution; sub-ms commits are filtered inside. */
const profileCommit: ProfilerOnRenderCallback = (id, phase, actualDuration) => {
	markTabProfile({subtree: id, phase, actualMs: actualDuration});
};

const EMPTY_LIVE_PROCS: NonNullable<TranscriptSlice['liveProcs']> = [];
const EMPTY_LIVE_TASKS: NonNullable<TranscriptSlice['liveTasks']> = [];
const EMPTY_CHILD_WORK: NonNullable<TranscriptSlice['childWork']> = [];
const STOPPABLE_GOAL_PHASES = new Set(['started', 'paused', 'escalated']);

const StableOpenTabStrip = memo(OpenTabStrip);

/** Bound per-task cache maps (keep-alive keeps a handful of tasks warm). */
function capMap<K, V>(map: Map<K, V>, max = 8): void {
	while (map.size > max) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) return;
		map.delete(oldest);
	}
}

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
	const [errorLine, setErrorLine] = useState<string | null>(null);
	// D10 regenerate: optimistic live hide of the victim answer while the
	// re-run streams. The wire's turn_started carries no supersedes, so the
	// client hides the rows itself; a RerunRun rejection (bridge:error with a
	// rerun.* code) rolls the hide back and the sticky banner explains why.
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
	 *  ttl: how long to keep the bubble if the engine never echoes it back
	 *  (interrupt echoes wait for cancel+resubmit, so they get a long ttl). */
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

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			if (gate.canCancel) {
				e.preventDefault();
				void window.fastIde.cancelRun();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [gate.canCancel]);

	// Per-task derived caches (keep-alive): single-slot useMemo recomputes on
	// A→B→A and hands every row a fresh identity, defeating the row memos the
	// stash relies on. Identity must survive the round trip, not just content.
	const taskKey = activeTaskId ?? '__none__';
	const projectorsRef = useRef(new Map<string, ReturnType<typeof createSessionViewProjector>>());
	const timelineCacheRef = useRef(
		new Map<
			string,
			{
				transcript: TranscriptSlice;
				canCancel: boolean;
				hiddenRuns?: ReadonlySet<string>;
				timeline: TimelineItem[];
				staleErrorIds: Set<string>;
				regenUserId: string | null;
			}
		>()
	);
	const projectMsRef = useRef(0);
	const activeRegen = regenPending && regenPending.taskId === activeTaskId ? regenPending.runId : null;
	// Content-keyed so streaming frames keep the same Set identity — a fresh Set
	// per delta would clear the projector's per-entry cache every frame.
	const supersededKey = useMemo(
		() => Object.keys(transcript.superseded ?? {}).sort().join('|'),
		[transcript]
	);
	const hiddenRuns = useMemo(() => {
		if (supersededKey.length === 0 && !activeRegen) return undefined;
		return new Set<string>([
			...supersededKey.split('|').filter(Boolean),
			...(activeRegen ? [activeRegen] : [])
		]);
	}, [supersededKey, activeRegen]);
	const timeline = useMemo(() => {
		const cached = timelineCacheRef.current.get(taskKey);
		if (
			cached &&
			cached.transcript === transcript &&
			cached.canCancel === gate.canCancel &&
			cached.hiddenRuns === hiddenRuns
		) {
			projectMsRef.current = 0;
			return cached.timeline;
		}
		let projector = projectorsRef.current.get(taskKey);
		if (!projector) {
			projector = createSessionViewProjector();
			projectorsRef.current.set(taskKey, projector);
			capMap(projectorsRef.current);
		}
		const t0 = performance.now();
		const next = projector(
			{
				entries: transcript.entries,
				approvals: transcript.approvals,
				questions: transcript.questions,
				questionBatches: transcript.questionBatches ?? [],
				subagents: transcript.subagents ?? []
			},
			transcript.codeChanges,
			{canCancel: gate.canCancel, rerunMarkers: transcript.superseded, hiddenRuns}
		);
		projectMsRef.current = performance.now() - t0;
		const regenUserId = regenUserIdOf(next);
		timelineCacheRef.current.set(taskKey, {
			transcript,
			canCancel: gate.canCancel,
			hiddenRuns,
			timeline: next,
			staleErrorIds: staleErrorCardIds(next),
			regenUserId
		});
		capMap(timelineCacheRef.current);
		return next;
	}, [taskKey, transcript, gate.canCancel, hiddenRuns]);
	timelineRef.current = timeline;

	// Stable Set identity across streaming frames — a fresh Set per frame would
	// fail TimelineRow's memo comparator and re-render every row per delta (P0-4).
	// Per task so a revisit reproduces the same Set (sameIdSet reuses it).
	const planIdsRef = useRef(new Map<string, Set<string>>());
	const buildActivePlanIds = useMemo(() => {
		const next = stablePlanBuildIds(timeline, planIdsRef.current.get(taskKey) ?? null);
		planIdsRef.current.set(taskKey, next);
		capMap(planIdsRef.current);
		return next;
	}, [timeline, taskKey]);

	// Live-run projection only. The strip's authority is the daemon's review list; this fills in
	// +/- stats and shows paths written but not yet recorded, so the list does not appear to lag.
	const reviewFilesRef = useRef<ReturnType<typeof reviewFiles>>([]);
	const reviewFileList = useMemo(() => {
		const next = reviewFiles(timeline, transcript.codeChanges);
		const stable = stableReviewFiles(next, reviewFilesRef.current);
		reviewFilesRef.current = stable;
		return stable;
	}, [timeline, transcript.codeChanges]);
	// The daemon's review list is per checkout (whole project); the drawer must only show the current
	// session's edits. Each change is anchored to a checkpoint, and each checkpoint names the run that
	// opened it — the same runId a user row in this session's timeline carries.
	const sessionRunIds = useMemo(() => {
		const ids = new Set<string>();
		for (const item of timeline) {
			if (item.kind === 'user' && item.runId) {
				ids.add(item.runId);
				// A row may be keyed by its turn (`<runId>-turn-1`) rather than the run; the checkpoint
				// names the base run, so both forms must match.
				ids.add(item.runId.replace(/-turn-\d+$/, ''));
			}
		}
		return ids;
	}, [timeline]);
	const sessionReviewList = useMemo(
		() => reviewListForSession(review.list, sessionRunIds),
		[review.list, sessionRunIds]
	);
	const hasReviewRows = sessionReviewList.changes.length > 0 || reviewFileList.length > 0;

	const timelineUndo = useUndoFlow(review);
	const [restoreFiles, setRestoreFiles] = useState(true);

	// Sending shows the bubble immediately; the engine echo replaces it when the
	// real user entry lands (count baseline, so resending identical text works) —
	// with a timeout fallback so a rewritten prompt (e.g. plan prefix) cannot
	// leave a stale ghost.
	const echoReflected = isEchoReflected(echo, timeline);
	useEffect(() => {
		if (!echo) return;
		if (echo.taskId !== activeTaskId || echoReflected) {
			setEcho(null);
			return;
		}
		const t = window.setTimeout(() => setEcho(null), echo.ttl ?? 10_000);
		return () => window.clearTimeout(t);
	}, [echo, echoReflected, activeTaskId]);

	const liveProcs = transcript.liveProcs ?? EMPTY_LIVE_PROCS;
	const liveTasks = transcript.liveTasks ?? EMPTY_LIVE_TASKS;
	const rawChildWork = transcript.childWork ?? EMPTY_CHILD_WORK;
	const goalCard = transcript.goalCard ?? null;
	const goalFlow = transcript.goalFlow;
	const composerStop = gate.canCancel
		? 'run'
		: goalCard && STOPPABLE_GOAL_PHASES.has(goalCard.phase)
			? 'goal'
			: undefined;
	// L1 Goal steps stay in childWork for GoalRow rich cards (BackgroundTools nests them).
	const childWork = useMemo(() => drawerChildWork(rawChildWork), [rawChildWork]);

	const displayTimeline = useMemo(() => {
		let items = timeline;
		if (echo && echo.taskId === activeTaskId && !echoReflected) {
			const item: TimelineItem = {
				kind: 'user',
				id: `echo-${echo.at}`,
				text: echo.text,
				isCommand: false
			};
			items = [...items, item];
		}
		// Chat status after Goal start — phase + member summary (no L1 Subagent body cards).
		// Attach hydrate seeds goalFlow for every phase (incl. finished) — same surface as live.
		if (
			goalCard &&
			goalFlow &&
			goalFlow.goalId === goalCard.goalId &&
			(goalCard.phase === 'started' ||
				goalCard.phase === 'paused' ||
				goalCard.phase === 'escalated' ||
				goalCard.phase === 'finished')
		) {
			const memberBits = goalFlow.members
				.map(m => `${m.name} ${m.status}`)
				.join(' · ');
			const phaseLabel =
				goalCard.phase === 'started'
					? 'running'
					: goalCard.phase === 'finished'
						? goalCard.status
						: goalCard.phase;
			items = placeGoalFlow(items, {
				kind: 'goalFlow',
				id: `goal-flow-${goalFlow.goalId}`,
				goalId: goalFlow.goalId,
				phase: goalCard.phase,
				...(goalCard.phase === 'finished' && goalCard.status
					? {status: goalCard.status}
					: {}),
				label: `Goal · ${phaseLabel}${memberBits ? ` · ${memberBits}` : ''}`,
				members: goalFlow.members.map(m => ({
					name: m.name,
					status: m.status,
					...(m.stepId ? {stepId: m.stepId} : {})
				}))
			});
		}
		return items;
	}, [timeline, echo, echoReflected, activeTaskId, goalCard, goalFlow]);

	const scrollKey = useMemo(() => transcriptScrollKey(displayTimeline), [displayTimeline]);

	const hasThread = displayTimeline.length > 0;

	// Decision Transition convergence (刀 3-2): once the engine resolves an
	// Approval / User Question it leaves this Task's pending lists. Scope the
	// prune so a focus switch cannot erase a background Task's local decision.
	useEffect(() => {
		if (!activeTaskId) return;
		pruneDecisions(
			activeTaskId,
			new Set(transcript.approvals.map(a => a.id)),
			new Set(transcript.questions.map(q => q.id)),
			new Set((transcript.questionBatches ?? []).map(q => q.rpcId))
		);
	}, [activeTaskId, transcript.approvals, transcript.questions, transcript.questionBatches]);

	const contextPaths = useMemo(() => {
		const set = new Set<string>();
		const addFromText = (text: string | null | undefined) => {
			if (!text) return;
			const matches = text.match(/([a-zA-Z0-9_.\-\/\\]+\.[a-zA-Z0-9]+)/g);
			if (!matches) return;
			for (const m of matches) {
				if (m.includes('/') || m.includes('\\')) {
					const clean = m.replace(/^[/\\]+/, '').replace(/\\/g, '/');
					set.add(clean);
				}
			}
		};

		if (transcript.codeChanges) {
			for (const c of transcript.codeChanges) {
				if (c.path) set.add(c.path.replace(/^[/\\]+/, '').replace(/\\/g, '/'));
			}
		}

		for (const item of timeline) {
			if (item.kind === 'file' && item.path) {
				set.add(item.path.replace(/^[/\\]+/, '').replace(/\\/g, '/'));
			} else if (item.kind === 'tool') {
				addFromText(item.title);
				addFromText(item.summary);
				addFromText(item.command);
				addFromText(item.output);
			} else if (item.kind === 'exploring') {
				for (const t of item.tools) {
					addFromText(t.title);
					addFromText(t.summary);
				}
			} else if (item.kind === 'processStack') {
				for (const s of item.steps) {
					if (s.kind === 'tool') {
						addFromText(s.title);
						addFromText(s.summary);
						addFromText(s.command);
						addFromText(s.output);
					}
				}
			}
		}
		return Array.from(set);
	}, [timeline, transcript.codeChanges]);

	const onOpenFileResolved = useCallback(
		(path: string, line?: number, endLine?: number) => {
			const clean = path.trim().replace(/^@/, '').replace(/^\.\//, '');
			let target = clean;
			if (!clean.includes('/')) {
				const match = contextPaths.find(p => p.endsWith('/' + clean) || p === clean);
				if (match) target = match;
			}
			onOpenFile(target, line, endLine);
		},
		[onOpenFile, contextPaths]
	);

	// Stable identities: onNearTop is an effect dep inside VirtualTranscript —
	// a fresh closure per render re-attached the scroll listener every frame.
	const onStopPlanBuild = useCallback(() => {
		void window.fastIde.cancelRun();
	}, []);
	// Double-clicks fire a second RerunRun before the first is even routed; its
	// busy rejection is what users read as "regenerate is broken". One in-flight
	// click per burst, shared by the regen chip and error-card retry.
	const regenSentAtRef = useRef(0);
	const regenClickAllowed = () => {
		const now = Date.now();
		if (now - regenSentAtRef.current < 1500) return false;
		regenSentAtRef.current = now;
		return true;
	};
	const noteRerunFailed = (taskId: string | null) => {
		setRegenPending(null);
		if (!taskId) return;
		setRegenRejected({taskId, code: 'send.session_not_ready'});
	};
	const onRerun = useCallback((runId: string) => {
		if (!regenClickAllowed()) return;
		const taskId = activeTaskRef.current;
		if (taskId) {
			setRegenRejected(null);
			setRegenPending({taskId, runId});
		}
		void window.fastIde.rerunRun(runId).then(
			ok => {
				if (!ok) noteRerunFailed(activeTaskRef.current);
			},
			() => noteRerunFailed(activeTaskRef.current)
		);
	}, []);
	const onRegenerate = useCallback(
		(runId: string) => {
			if (!activeTaskId) return;
			if (!regenClickAllowed()) return;
			setRegenRejected(null);
			setRegenPending({taskId: activeTaskId, runId});
			void window.fastIde.rerunRun(runId).then(
				ok => {
					if (!ok) noteRerunFailed(activeTaskId);
				},
				() => noteRerunFailed(activeTaskId)
			);
		},
		[activeTaskId]
	);
	const onContinueRun = useCallback(() => {
		void window.fastIde.sendMessage('continue', undefined, activeTaskId ?? undefined);
	}, [activeTaskId]);
	const onNearTop = useCallback(() => {
		void window.fastIde.requestOlderHistory();
	}, []);
	// 刀 5b: stable renderItem — FlowSection's memo boundary needs it; an inline
	// closure would re-render every section per streaming frame. Cached per task
	// (not single-slot useCallback) so an A→B→A revisit with unchanged inputs
	// hands back the exact same closure and every section bails out.
	const renderItemCacheRef = useRef(
		new Map<string, {deps: readonly unknown[]; fn: (item: TimelineItem) => ReactNode}>()
	);
	const renderItemDeps: readonly unknown[] = [
		activeTaskId,
		gate.canCancel,
		onOpenFileResolved,
		buildActivePlanIds,
		engineKind,
		onRerun,
		onContinueRun,
		onRegenerate,
		timelineCacheRef.current.get(taskKey)?.staleErrorIds,
		timelineCacheRef.current.get(taskKey)?.regenUserId ?? null,
		Boolean(activeRegen)
	];
	const cachedRenderItem = renderItemCacheRef.current.get(taskKey);
	const renderItem =
		cachedRenderItem &&
		cachedRenderItem.deps.length === renderItemDeps.length &&
		cachedRenderItem.deps.every((dep, i) => dep === renderItemDeps[i])
			? cachedRenderItem.fn
			: (item: TimelineItem) => (
					<TimelineRow
						item={item}
						decisionScope={activeTaskId ?? ''}
						canCancel={gate.canCancel}
						showUserStop={item.kind === 'user' && Boolean(item.showStop) && !item.planBuild}
						onOpenFile={onOpenFileResolved}
						buildActivePlanIds={buildActivePlanIds}
						engineKind={engineKind}
						onRerun={onRerun}
						onContinueRun={onContinueRun}
						onRegenerate={onRegenerate}
						errorStale={
							item.kind === 'assistant' &&
							timelineCacheRef.current.get(taskKey)?.staleErrorIds.has(item.id) === true
						}
						regenUserId={timelineCacheRef.current.get(taskKey)?.regenUserId ?? null}
						runBusy={gate.canCancel}
						retryBusy={Boolean(activeRegen)}
					/>
				);
	if (renderItem !== cachedRenderItem?.fn) {
		renderItemCacheRef.current.set(taskKey, {deps: renderItemDeps, fn: renderItem});
		capMap(renderItemCacheRef.current);
	}
	const onSubmitSuccess = useCallback(
		(text: string) => {
			stickToBottomRef.current = true;
			// Echo only on direct submit — busy submits enqueue as Follow-up
			// (steering) and already surface in the queue drawer.
			if (gate.runState === 'idle') {
				setEcho(makeQueueEcho(activeTaskId, text, timelineRef.current));
			}
		},
		[gate.runState, activeTaskId]
	);
	const onComposerError = useCallback((message: string | null, taskId: string | null) => {
		if (activeTaskRef.current !== taskId) return;
		setErrorLine(message);
		if (message) setEcho(null);
	}, []);
	/** Queue interrupt: cancel + settle + submit. The queued row vanishes
	 *  instantly and the text shows as a normal user bubble until the engine's
	 *  real entry lands. */
	const onInterrupt = useCallback(
		(item: QueueItem) => {
			stickToBottomRef.current = true;
			setEcho(makeQueueEcho(activeTaskId, item.text, timelineRef.current, 15_000));
		},
		[activeTaskId]
	);
	/** Interrupt failed after the row was dropped — the queue row unhides
	 *  itself; retire the optimistic bubble and surface why. */
	const onInterruptError = useCallback((message: string) => {
		setEcho(null);
		setErrorLine(message);
	}, []);
	const composerStack = useMemo(
		() => (
			<div className="overflow-hidden rounded-t-3xl border-b border-border/40 divide-y divide-border/40 bg-muted/20">
				<BackgroundToolsSection
					procs={liveProcs}
					tasks={liveTasks}
					childWork={childWork}
					goalCard={goalCard}
					onOpenTeams={onOpenTeams}
				/>
				<GoalIsland caps={dshCaps} goal={dshGoal} />
				{dshCaps?.queue ? (
					<QueueDock capsQueue={dshCaps.queue} items={dshQueue} />
				) : (
					<QueuedMessagesSection
						queue={queue}
						queuePaused={queuePaused}
						onInterrupt={onInterrupt}
						onInterruptError={onInterruptError}
					/>
				)}
				{hasReviewRows ? (
					<ReviewChangesStrip
						review={review}
						list={sessionReviewList}
						files={reviewFileList}
						onOpenChange={onOpenReviewDiff}
						onOpenFile={onOpenFileResolved}
					/>
				) : null}
			</div>
		),
		[
			liveProcs,
			liveTasks,
			childWork,
			goalCard,
			onOpenTeams,
			queue,
			queuePaused,
			onInterrupt,
			onInterruptError,
			dshCaps,
			dshQueue,
			dshGoal,
			reviewFileList,
			review,
			sessionReviewList,
			hasReviewRows,
			onOpenReviewDiff
		]
	);
	const hasComposerStack =
		liveProcs.length > 0 ||
		liveTasks.length > 0 ||
		childWork.length > 0 ||
		transcript.goalCard != null ||
		queue.length > 0 ||
		(dshCaps?.queue === true && dshQueue.length > 0) ||
		(dshCaps?.goal === true && dshGoal != null) ||
		hasReviewRows;

	// Tab-switch trace: sample each focused render + a post-paint rAF so long
	// threads show whether cost is deferred release, projection, or layout.
	const deferredPending = transcript !== currentTranscript;
	if (activeTabFocusTaskId() === activeTaskId && activeTaskId) {
		markTabRender({
			taskId: activeTaskId,
			atMs: performance.now(),
			bodyMissing,
			deferredPending,
			transcriptEntries: currentTranscript.entries.length,
			timelineItems: displayTimeline.length,
			projectMs: Number(projectMsRef.current.toFixed(2))
		});
	}
	useEffect(() => {
		if (!activeTaskId || activeTabFocusTaskId() !== activeTaskId) return;
		let inner = 0;
		const outer = requestAnimationFrame(() => {
			inner = requestAnimationFrame(() => {
				markTabPaint({taskId: activeTaskId});
			});
		});
		return () => {
			cancelAnimationFrame(outer);
			cancelAnimationFrame(inner);
		};
	}, [
		activeTaskId,
		bodyMissing,
		deferredPending,
		currentTranscript.entries.length,
		displayTimeline.length
	]);

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
