import type {TranscriptSlice, WorkspaceEvent, WorkspaceState} from '../workspaceStore';
import {
	IDLE_GATE,
	applyBody,
	applyTasksMeta,
	applyTasksStructure,
	emptySlice,
	findTaskContext,
	keepEqualGate,
	markActive,
	markProjectsActive,
	reconcileProjectTasks,
	reconcileProjects
} from './reconcile';

export function reduceWorkspace(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
	switch (event.type) {
		case 'tasks:changed': {
			return {
				...applyTasksStructure(state, event.payload),
				tasksMetaFromPush: true
			};
		}
		case 'tasks:pull': {
			const snap = event.payload;
			let next = state;
		if (!state.tasksMetaFromPush) {
			next = applyTasksStructure(next, snap);
		} else if (
			state.modelCatalog.length === 0 &&
			(snap.modelCatalog?.length ?? 0) > 0
		) {
			// Restore often pushes empty chrome before ListProviders; cold pull must still heal.
			next = {
				...next,
				modelCatalog: snap.modelCatalog,
				model: snap.model,
				modelDisplay: snap.modelDisplay,
				...(snap.runMode ? {runMode: snap.runMode} : {}),
				...(snap.engineKind ? {engineKind: snap.engineKind} : {}),
				...(snap.availableEngineIds ? {availableEngineIds: snap.availableEngineIds} : {}),
				...(snap.effort !== undefined ? {effort: snap.effort} : {}),
				...(snap.thinking !== undefined ? {thinking: snap.thinking} : {})
			};
		}
			const taskId = snap.activeTaskId;
			const cachedRevision = taskId ? state.bodyRevision[taskId] : undefined;
			const pullIsNewer =
				snap.bodyRevision !== undefined &&
				(cachedRevision === undefined || snap.bodyRevision > cachedRevision);
			if (taskId && (!state.bodyFromPush[taskId] || pullIsNewer)) {
				next = applyBody(
					next,
					taskId,
					{
						entries: snap.transcript,
						usage: snap.usage ?? undefined,
						contextPrunes: snap.contextPrunes ?? [],
						compacting: snap.compacting ?? undefined,
						childTranscripts: snap.childTranscripts ?? {},
						approvals: snap.approvals,
						questions: snap.questions,
						questionBatches: snap.questionBatches ?? [],
						subagents: snap.subagents ?? [],
						contextInjections: snap.contextInjections ?? [],
						superseded: snap.superseded ?? {},
						codeChanges: snap.codeChanges,
						liveProcs: snap.liveProcs ?? [],
						liveTasks: snap.liveTasks ?? [],
						childWork: snap.childWork ?? [],
						goalFlow: snap.goalFlow,
						goalCard: snap.goalCard ?? null
					},
					snap.bodyRevision !== undefined,
					snap.bodyRevision
				);
			}
			return next;
		}
		case 'body:pulled': {
			const {payload} = event;
			if (
				payload.bodyRevision !== undefined &&
				(state.bodyRevision[payload.taskId] ?? 0) > payload.bodyRevision
			) {
				return state;
			}
			return applyBody(
				state,
				payload.taskId,
				{
					entries: payload.entries,
					usage: payload.usage ?? undefined,
					contextPrunes: payload.contextPrunes ?? [],
					compacting: payload.compacting ?? undefined,
					childTranscripts: payload.childTranscripts ?? {},
					approvals: payload.approvals,
					questions: payload.questions,
					questionBatches: payload.questionBatches ?? [],
					subagents: payload.subagents ?? [],
					contextInjections: payload.contextInjections ?? [],
					superseded: payload.superseded ?? {},
					codeChanges: payload.codeChanges,
					liveProcs: payload.liveProcs ?? [],
					liveTasks: payload.liveTasks ?? [],
					childWork: payload.childWork ?? [],
					goalFlow: payload.goalFlow,
					goalCard: payload.goalCard ?? null
				},
				true,
				payload.bodyRevision
			);
		}
		case 'transcript:patched': {
			const {payload} = event;
			if (
				payload.bodyRevision !== undefined &&
				(state.bodyRevision[payload.taskId] ?? 0) > payload.bodyRevision
			) {
				return state;
			}
			const next = applyBody(
				state,
				payload.taskId,
				{
					entries: payload.entries,
					usage: payload.usage ?? undefined,
					contextPrunes: payload.contextPrunes ?? [],
					compacting: payload.compacting ?? undefined,
					childTranscripts: payload.childTranscripts ?? {},
					approvals: payload.approvals,
					questions: payload.questions,
					questionBatches: payload.questionBatches ?? [],
					subagents: payload.subagents ?? [],
					contextInjections: payload.contextInjections ?? [],
					superseded: payload.superseded ?? {},
					codeChanges: payload.codeChanges,
					liveProcs: payload.liveProcs ?? [],
					liveTasks: payload.liveTasks ?? [],
					childWork: payload.childWork ?? [],
					goalFlow: payload.goalFlow,
					goalCard: payload.goalCard ?? null
				},
				true,
				payload.bodyRevision
			);
			// Content path never owns focus; gate only for the focused Task.
			if (payload.taskId !== state.activeTaskId) return next;
			return {...next, gate: keepEqualGate(state.gate, payload.gate)};
		}
		case 'transcript:tailPatched': {
			const {payload} = event;
			if (
				payload.bodyRevision !== undefined &&
				(state.bodyRevision[payload.taskId] ?? 0) > payload.bodyRevision
			) {
				return state;
			}
			const existing = state.byTaskId[payload.taskId];
			// No local base (cold task) or desynced base: ignore — the next full
			// transcript:patched / focus / snapshot publish heals the body.
			if (!existing) return state;
			if (payload.from > existing.entries.length) return state;
			const entries = existing.entries.slice(0, payload.from).concat(payload.entries);
			if (entries.length !== payload.total) return state;
			const slice: TranscriptSlice = {
				entries,
				usage: payload.usage ?? existing.usage ?? undefined,
				contextPrunes: payload.contextPrunes ?? existing.contextPrunes ?? [],
				compacting: payload.compacting === undefined ? existing.compacting : (payload.compacting ?? undefined),
				childTranscripts: payload.childTranscripts ?? existing.childTranscripts ?? {},
				approvals: payload.approvals ?? existing.approvals,
				questions: payload.questions ?? existing.questions,
				questionBatches: payload.questionBatches ?? existing.questionBatches ?? [],
				subagents: payload.subagents ?? existing.subagents ?? [],
				contextInjections: payload.contextInjections ?? existing.contextInjections ?? [],
				superseded: payload.superseded ?? existing.superseded ?? {},
				codeChanges: payload.codeChanges ?? existing.codeChanges,
				liveProcs: payload.liveProcs ?? existing.liveProcs ?? [],
				liveTasks: payload.liveTasks ?? existing.liveTasks ?? [],
				childWork: payload.childWork ?? existing.childWork ?? [],
				goalFlow: payload.goalFlow !== undefined ? payload.goalFlow : existing.goalFlow,
				goalCard: payload.goalCard !== undefined ? payload.goalCard : (existing.goalCard ?? null)
			};
			const next = applyBody(
				state,
				payload.taskId,
				slice,
				true,
				payload.bodyRevision
			);
			if (payload.taskId !== state.activeTaskId) return next;
			return {...next, gate: keepEqualGate(state.gate, payload.gate)};
		}
		case 'projects:changed': {
			const p = event.payload;
			const hydrated = {...state.projectTasksHydrated};
			if (p.projectTasksHydrated) {
				Object.assign(hydrated, p.projectTasksHydrated);
			} else if (p.projectTasks) {
				for (const id of Object.keys(p.projectTasks)) {
					hydrated[id] = true;
				}
			}
			// Focus owns activeProjectId — structure only remakes list `active` flags.
			const activeProjectId = state.activeProjectId;
			return {
				...state,
				projects: reconcileProjects(
					state.projects,
					markProjectsActive(p.projects, activeProjectId)
				),
				activeProjectId,
				projectTasks: p.projectTasks
					? reconcileProjectTasks(state.projectTasks, p.projectTasks)
					: state.projectTasks,
				projectTasksHydrated: hydrated,
				engineStatus: p.engineStatus !== undefined ? (p.engineStatus ?? null) : state.engineStatus,
				engineError: p.engineError !== undefined ? (p.engineError ?? null) : state.engineError,
				projectsFromPush: true
			};
		}
		case 'workspace:focus': {
			const p = event.payload;
			if (p.focusEpoch < state.focusEpoch) {
				return state;
			}
			let next: WorkspaceState = {
				...state,
				focusEpoch: p.focusEpoch,
				projects: reconcileProjects(state.projects, p.projects),
				activeProjectId: p.activeProjectId,
				project: p.project,
				engineStatus: p.engineStatus !== undefined ? (p.engineStatus ?? null) : state.engineStatus,
				engineError: p.engineError !== undefined ? (p.engineError ?? null) : state.engineError,
				projectsFromPush: true,
				projectFromPush: true,
				tasksMetaFromPush: true,
				activeBodyRevision: p.bodyRevision ?? null
			};
			next = applyTasksMeta(next, {
				tasks: p.tasks,
				chats: p.chats,
				defaultTasks: p.defaultTasks,
				defaultTasksHydrated: p.defaultTasksHydrated,
				activeTaskId: p.activeTaskId,
				activeKind: p.activeKind,
				gate: p.gate,
				model: p.model,
				modelDisplay: p.modelDisplay,
				modelCatalog: p.modelCatalog,
				runMode: p.runMode,
				engineKind: p.engineKind,
				availableEngineIds: p.availableEngineIds,
				effort: p.effort,
				thinking: p.thinking,
				slashCatalog: p.slashCatalog ?? [],
				slashCatalogHydrated: p.slashCatalogHydrated,
				queue: p.queue,
				queuePaused: p.queuePaused,
				dshCaps: p.dshCaps,
				dshQueue: p.dshQueue ?? [],
				dshGoal: p.dshGoal ?? null,
				engineStatus: p.engineStatus,
				engineError: p.engineError
			});
			if (p.activeTaskId) {
				const existing = state.byTaskId[p.activeTaskId];
				if (p.transcript !== undefined) {
					// Legacy full-body focus (still valid wire shape).
					const incoming = {
						entries: p.transcript,
						usage: p.usage ?? undefined,
						contextPrunes: p.contextPrunes ?? [],
						compacting: p.compacting ?? undefined,
						childTranscripts: p.childTranscripts ?? {},
						approvals: p.approvals ?? [],
						questions: p.questions ?? [],
						questionBatches: p.questionBatches ?? [],
						subagents: p.subagents ?? [],
						contextInjections: p.contextInjections ?? [],
						superseded: p.superseded ?? {},
						codeChanges: p.codeChanges ?? [],
						liveProcs: p.liveProcs ?? [],
						liveTasks: p.liveTasks ?? [],
						childWork: p.childWork ?? [],
						goalFlow: p.goalFlow,
						// Host truth on focus — background goal_updated never patched this renderer cache.
						goalCard: p.goalCard ?? null
					};
					// Attach-time focus often ships transcript:[] before session_restored.
					// A later empty focus must not blank a body already filled by patch.
					const keepExisting =
						Boolean(existing?.entries.length) && incoming.entries.length === 0;
					next = applyBody(
						next,
						p.activeTaskId,
						keepExisting && existing ? {...existing, goalCard: p.goalCard ?? null} : incoming,
						true,
						p.bodyRevision
					);
				} else if (existing) {
					// Slim focus (P1-6): body stays renderer-cached; goalCard is host truth.
					// Keep the slice identity when goalCard is unchanged — per-task
					// derived caches (timeline/sections) key on it across revisits.
					const goalCard = p.goalCard ?? null;
					next = applyBody(
						next,
						p.activeTaskId,
						existing.goalCard === goalCard ? existing : {...existing, goalCard},
						false
					);
				} else if (p.goalCard != null) {
					// No cached body yet — surface goal chrome without claiming a body push,
					// so the cold `task:list` pull can still fill entries.
					next = applyBody(
						next,
						p.activeTaskId,
						{...emptySlice(), goalCard: p.goalCard},
						false
					);
				}
			}
			return next;
		}
		case 'focus:clear': {
			const {focusEpoch} = event.payload;
			if (focusEpoch < state.focusEpoch) return state;
			return {
				...state,
				focusEpoch,
				activeTaskId: null,
				activeKind: null,
				activeBodyRevision: null,
				gate: IDLE_GATE,
				queue: [],
				queuePaused: false,
				dshCaps: undefined,
				dshQueue: [],
				dshGoal: null,
				tasks: markActive(state.tasks, null),
				chats: markActive(state.chats, null),
				defaultTasks: markActive(state.defaultTasks, null)
			};
		}
		case 'focus:optimistic': {
			const {taskId, focusEpoch} = event.payload;
			if (focusEpoch < state.focusEpoch) return state;
			const ctx = findTaskContext(state, taskId);
			if (!ctx) return state;

			const kind = ctx.task.kind ?? 'task';
			let next: WorkspaceState = {
				...state,
				focusEpoch,
				activeTaskId: taskId,
				activeKind: kind,
				activeBodyRevision: null,
				gate: IDLE_GATE,
				queue: [],
				queuePaused: false,
				dshCaps: undefined,
				dshQueue: [],
				dshGoal: null
			};

			if (ctx.source === 'project' && ctx.projectId) {
				const list = state.projectTasks[ctx.projectId] ?? [];
				next = {
					...next,
					activeProjectId: ctx.projectId,
					projects: markProjectsActive(state.projects, ctx.projectId),
					tasks: markActive(list, taskId),
					chats: markActive(
						state.activeProjectId === ctx.projectId ? state.chats : [],
						taskId
					),
					project: (() => {
						const snap = state.projects.find(p => p.id === ctx.projectId);
						if (!snap) return state.project;
						return {
							id: snap.id,
							path: snap.path,
							status: snap.status,
							error: snap.error,
							cwd: snap.cwd ?? snap.path
						};
					})()
				};
			} else if (ctx.source === 'default') {
				next = {
					...next,
					defaultTasks: markActive(state.defaultTasks, taskId),
					tasks: markActive(state.defaultTasks, taskId)
				};
			} else if (ctx.source === 'chat') {
				next = {
					...next,
					chats: markActive(state.chats, taskId),
					tasks: markActive(state.tasks, taskId)
				};
			} else {
				next = {
					...next,
					tasks: markActive(state.tasks, taskId)
				};
			}

			const body = state.byTaskId[taskId] ?? emptySlice();
			return applyBody(next, taskId, body, false);
		}
		case 'focus:rollback': {
			const {failedEpoch, snapshot} = event.payload;
			// A rejected A→B select may resolve after a later B→C select succeeded.
			// Never let that late rejection move focus backwards or lower the epoch.
			if (state.focusEpoch !== failedEpoch) return state;
			const activeTaskId = snapshot.activeTaskId;
			const activeProjectId = snapshot.activeProjectId;
			const tasks = activeProjectId
				? state.projectTasks[activeProjectId] ?? snapshot.tasks
				: snapshot.tasks;
			const projectSnap = state.projects.find(p => p.id === activeProjectId);
			return {
				...state,
				focusEpoch: failedEpoch,
				activeProjectId,
				activeTaskId,
				activeKind: snapshot.activeKind,
				projects: markProjectsActive(state.projects, activeProjectId),
				project: projectSnap
					? {
							id: projectSnap.id,
							path: projectSnap.path,
							status: projectSnap.status,
							error: projectSnap.error,
							cwd: projectSnap.cwd ?? projectSnap.path
						}
					: snapshot.project,
				tasks: markActive(tasks, activeTaskId),
				chats: markActive(snapshot.chats, activeTaskId),
				defaultTasks: markActive(state.defaultTasks, activeTaskId),
				gate: snapshot.gate,
				queue: snapshot.queue,
				queuePaused: snapshot.queuePaused,
				dshCaps: snapshot.dshCaps,
				dshQueue: snapshot.dshQueue ?? [],
				dshGoal: snapshot.dshGoal ?? null,
				activeBodyRevision: snapshot.activeBodyRevision
			};
		}
		case 'project:changed': {
			return {
				...state,
				project: event.payload,
				projectFromPush: true
			};
		}
		case 'projects:pull': {
			const p = event.payload;
			if (state.projectsFromPush && state.projectFromPush) {
				return state;
			}
			let next = state;
			if (!state.projectsFromPush) {
				const hydrated = {...state.projectTasksHydrated};
				if (p.projectTasksHydrated) {
					Object.assign(hydrated, p.projectTasksHydrated);
				} else if (p.projectTasks) {
					for (const id of Object.keys(p.projectTasks)) {
						hydrated[id] = true;
					}
				}
				const activeProjectId = state.activeProjectId;
				next = {
					...next,
					projects: reconcileProjects(
						state.projects,
						markProjectsActive(p.projects, activeProjectId)
					),
					activeProjectId,
					projectTasks: p.projectTasks
						? reconcileProjectTasks(next.projectTasks, p.projectTasks)
						: next.projectTasks,
					projectTasksHydrated: hydrated,
					engineStatus:
						p.engineStatus !== undefined ? (p.engineStatus ?? null) : next.engineStatus,
					engineError: p.engineError !== undefined ? (p.engineError ?? null) : next.engineError
				};
			}
			return next;
		}
		case 'bridge:error': {
			// Empty message + no code clears sticky banner (prior create_failed after success).
			const msg = event.payload.message?.trim() ?? '';
			const code = event.payload.code?.trim() || undefined;
			if (!msg && !code) return {...state, bridgeError: null};
			return {
				...state,
				bridgeError: {
					message: msg,
					...(code ? {code} : {}),
					...(event.payload.params ? {params: event.payload.params} : {})
				}
			};
		}
		default:
			return state;
	}
}
