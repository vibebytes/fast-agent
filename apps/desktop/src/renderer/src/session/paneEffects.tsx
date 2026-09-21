import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
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
import type {DshCaps, DshGoalView, DshQueueItem, QueueItem} from '../env';
import type {TranscriptSlice, WorkspaceStore} from '../workspaceStore';
import {BackgroundToolsSection} from './BackgroundTools';
import {drawerChildWork} from './backgroundTasks';
import {QueueDock} from '../dsh/queue/QueueDock';
import {GoalIsland} from '../dsh/goal/GoalIsland';
import {reviewListForSession} from '../review/agentReview';
import type {AgentReview} from '../review/useAgentReview';
import {useUndoFlow} from '../review/useUndoFlow';
import {QueuedMessagesSection} from './QueuedMessages';
import {isEchoExpired, isEchoReflected, makeQueueEcho, type QueueEcho} from './queueEcho';
import {pruneDecisions} from './pendingDecisions';
import {ReviewChangesStrip} from './ReviewChangesStrip';
import {stablePlanBuildIds, stableReviewFiles, transcriptScrollKey} from './timelineDerived';
import {TimelineRow} from './TimelineRow';
import {activeTabFocusTaskId, markTabPaint, markTabRender} from '../performanceTrace';

const EMPTY_LIVE_PROCS: NonNullable<TranscriptSlice['liveProcs']> = [];
const EMPTY_LIVE_TASKS: NonNullable<TranscriptSlice['liveTasks']> = [];
const EMPTY_CHILD_WORK: NonNullable<TranscriptSlice['childWork']> = [];
const STOPPABLE_GOAL_PHASES = new Set(['started', 'paused', 'escalated']);

function capMap<K, V>(map: Map<K, V>, max = 8): void {
	while (map.size > max) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) return;
		map.delete(oldest);
	}
}

export type PaneEffectsHost = Record<string, any>;

export function usePaneEffects(h: PaneEffectsHost) {
	const {
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
	} = h;

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
				subagents: transcript.subagents ?? [],
				contextInjections: transcript.contextInjections ?? []
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
	// real user entry lands (count baseline, so resending identical text works).
	// Wide fallback TTL only covers slash rewrite / reject / send failure — cases
	// that never emit a matching user row (P1-4: do not drop a late turn_started).
	const echoReflected = isEchoReflected(echo, timeline);
	useEffect(() => {
		if (!echo) return;
		if (echo.taskId !== activeTaskId || echoReflected) {
			setEcho(null);
			return;
		}
		const remain = echo.expiresAt - Date.now();
		if (remain <= 0) {
			setEcho(null);
			return;
		}
		const timer = window.setTimeout(() => setEcho(null), remain);
		return () => window.clearTimeout(timer);
	}, [echo, echoReflected, activeTaskId]);

	const liveProcs = transcript.liveProcs ?? EMPTY_LIVE_PROCS;
	const liveTasks = transcript.liveTasks ?? EMPTY_LIVE_TASKS;
	const rawChildWork = transcript.childWork ?? EMPTY_CHILD_WORK;
	const goalCard = transcript.goalCard ?? null;
	const goalFlow = transcript.goalFlow;
	const composerStop: 'run' | 'goal' | undefined = gate.canCancel
		? 'run'
		: goalCard && STOPPABLE_GOAL_PHASES.has(goalCard.phase)
			? 'goal'
			: undefined;
	// L1 Goal steps stay in childWork for GoalRow rich cards (BackgroundTools nests them).
	const childWork = useMemo(() => drawerChildWork(rawChildWork), [rawChildWork]);

	const displayTimeline = useMemo(() => {
		let items = timeline;
		if (echo && echo.taskId === activeTaskId && !echoReflected && !isEchoExpired(echo)) {
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
				.map((m: {name: string; status: string}) => `${m.name} ${m.status}`)
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
				members: goalFlow.members.map((m: {name: string; status: string; stepId?: string}) => ({
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
			new Set(transcript.approvals.map((a: {id: string}) => a.id)),
			new Set(transcript.questions.map((q: {id: string}) => q.id)),
			new Set((transcript.questionBatches ?? []).map((q: {rpcId: string}) => q.rpcId))
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
		store,
		dshCaps,
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
						store={store}
						dshCaps={dshCaps}
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
			setEcho(makeQueueEcho(activeTaskId, item.text, timelineRef.current));
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

	return {
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
	};
}
