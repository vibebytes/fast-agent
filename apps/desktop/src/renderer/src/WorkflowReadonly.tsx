import {shellT as t} from './i18n/t';
import {useMemo, useCallback, memo, useEffect, useRef, useState} from 'react';
import {
	ReactFlow,
	Background,
	BackgroundVariant,
	Controls,
	Handle,
	Position,
	MarkerType,
	type Node,
	type Edge,
	type NodeProps
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './workflowLive.css';
import {cn} from '@fast-ide/ui/lib/utils';
import {CheckCircle2, Flag, ShieldCheck, Sparkles, Users, Wrench} from 'lucide-react';
import {workflowStatusLabel} from './teamsDisplay';
import {workflowNodeStatus, type WorkflowNodeState} from './workflowNodeStatus';

export type WorkflowStep = {
	id?: string;
	use?: string;
	name?: string;
	depends_on?: string[];
	status?: string;
};

export function parseWorkflowSteps(workflowJson?: string | null): WorkflowStep[] {
	if (!workflowJson?.trim()) return [];
	try {
		const raw = JSON.parse(workflowJson) as {
			kind?: string;
			nodes?: WorkflowStep[];
			steps?: WorkflowStep[];
		};
		const nodes = raw.nodes ?? raw.steps;
		if (!Array.isArray(nodes)) return [];
		return linearizeIfNeeded(nodes, raw.kind);
	} catch {
		return [];
	}
}

function stepKey(s: WorkflowStep, i: number): string {
	return s.id || s.use || `step-${i}`;
}

/** Pipeline without depends_on → treat as sequential chain. */
function linearizeIfNeeded(steps: WorkflowStep[], kind?: string): WorkflowStep[] {
	const hasDeps = steps.some(s => (s.depends_on?.length ?? 0) > 0);
	if (hasDeps || steps.length <= 1) return steps;
	if (kind === 'dag') return steps;
	return steps.map((s, i) =>
		i === 0 ? s : {...s, depends_on: [stepKey(steps[i - 1]!, i - 1)]}
	);
}

/** Topo layers by depends_on — same layer = parallel-ready peers. */
export function workflowLayers(steps: WorkflowStep[]): WorkflowStep[][] {
	if (steps.length === 0) return [];
	const ids = steps.map((s, i) => stepKey(s, i));
	const byId = new Map(ids.map((id, i) => [id, steps[i]!]));
	const depth = new Map<string, number>();
	const visiting = new Set<string>();
	function depthOf(id: string): number {
		if (depth.has(id)) return depth.get(id)!;
		if (visiting.has(id)) return 0;
		visiting.add(id);
		const step = byId.get(id);
		const deps = (step?.depends_on ?? []).filter(d => byId.has(d));
		const d = deps.length === 0 ? 0 : Math.max(...deps.map(depthOf)) + 1;
		visiting.delete(id);
		depth.set(id, d);
		return d;
	}
	for (const id of ids) depthOf(id);
	const max = Math.max(0, ...[...depth.values()]);
	const layers: WorkflowStep[][] = Array.from({length: max + 1}, () => []);
	for (const id of ids) {
		const s = byId.get(id);
		if (s) layers[depth.get(id) ?? 0]!.push(s);
	}
	return layers.filter(l => l.length > 0);
}

type RoleKind = 'moderator' | 'verifier' | 'executor' | 'researcher' | 'default';

type RoleTheme = {
	kind: RoleKind;
	/** Tailwind classes for the node shell */
	shell: string;
	/** Accent for edge stroke */
	stroke: string;
	/** Soft fill for handle */
	handle: string;
	shape: 'pill' | 'rounded' | 'soft' | 'diamond' | 'shield';
	Icon: typeof Flag;
};

const ROLE_THEMES: Record<RoleKind, RoleTheme> = {
	moderator: {
		kind: 'moderator',
		shell: 'border-violet-400/70 bg-gradient-to-br from-violet-500/15 to-violet-500/5 text-violet-950 dark:text-violet-100',
		stroke: '#8b5cf6',
		handle: '#8b5cf6',
		shape: 'diamond',
		Icon: Users
	},
	verifier: {
		kind: 'verifier',
		shell: 'border-emerald-400/70 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 text-emerald-950 dark:text-emerald-100',
		stroke: '#10b981',
		handle: '#10b981',
		shape: 'shield',
		Icon: ShieldCheck
	},
	executor: {
		kind: 'executor',
		shell: 'border-amber-400/70 bg-gradient-to-br from-amber-500/18 to-orange-500/5 text-amber-950 dark:text-amber-100',
		stroke: '#f59e0b',
		handle: '#f59e0b',
		shape: 'soft',
		Icon: Wrench
	},
	researcher: {
		kind: 'researcher',
		shell: 'border-sky-400/70 bg-gradient-to-br from-sky-500/15 to-cyan-500/5 text-sky-950 dark:text-sky-100',
		stroke: '#0ea5e9',
		handle: '#0ea5e9',
		shape: 'rounded',
		Icon: Sparkles
	},
	default: {
		kind: 'default',
		shell: 'border-slate-300/80 bg-gradient-to-br from-slate-500/10 to-background text-foreground',
		stroke: '#94a3b8',
		handle: '#94a3b8',
		shape: 'rounded',
		Icon: Sparkles
	}
};

/** Shared look for every not-yet-run step (+ Result) — role color only after start. */
const PENDING_SHELL =
	'border-dashed border-muted-foreground/45 bg-muted/35 text-muted-foreground';
const PENDING_STROKE = '#94a3b8';
const PENDING_HANDLE = '#94a3b8';

function themeForState(theme: RoleTheme, st: WorkflowNodeState | 'template'): RoleTheme {
	if (st === 'pending' || st === 'skipped') {
		return {
			...theme,
			shell: PENDING_SHELL,
			stroke: PENDING_STROKE,
			handle: PENDING_HANDLE
		};
	}
	return theme;
}

type ResultTerminalState = 'pending' | 'done' | 'failed';

function resultTerminalState(goalStatus?: string | null): ResultTerminalState {
	const s = (goalStatus ?? '').toLowerCase();
	if (s === 'passed' || s === 'succeeded') return 'done';
	if (s === 'failed' || s === 'cancelled' || s === 'discarded') return 'failed';
	return 'pending';
}

const RESEARCHER_HINTS =
	/macro|industry|quant|news|research|analyst|bull|bear|scout|explore|alpha|beta|fund|sector/i;
const MODERATOR_HINTS = /moderator|chair|orchestr|leader|facilitat|host|director|pm\b/i;
const VERIFIER_HINTS = /verif|qa|check|review|accept|critic|judge|audit/i;
const EXECUTOR_HINTS = /execut|impl|dev|coder|writer|builder|do[_\-]?er/i;

function roleKindOf(use?: string, name?: string): RoleKind {
	const key = `${use ?? ''} ${name ?? ''}`.trim();
	if (!key) return 'default';
	if (MODERATOR_HINTS.test(key)) return 'moderator';
	if (VERIFIER_HINTS.test(key)) return 'verifier';
	if (EXECUTOR_HINTS.test(key)) return 'executor';
	if (RESEARCHER_HINTS.test(key)) return 'researcher';
	// Heuristic: short specialist names (macro/news…) → researcher palette
	if (/^[a-z][a-z0-9_\-]{1,16}$/i.test(use ?? '') && !/agent|step|node/i.test(use ?? ''))
		return 'researcher';
	return 'default';
}

type TerminalData = {
	label: string;
	subtitle?: string;
	kind: 'goal' | 'result';
	/** Result only — matches pending step chrome until Goal finishes. */
	resultState?: ResultTerminalState;
};

type WfNodeData = {
	label: string;
	subtitle?: string;
	state: WorkflowNodeState | 'template';
	use?: string;
	role: RoleKind;
	theme: RoleTheme;
};

const NODE_W = 132;
const NODE_H = 52;
const TERM_W = 96;
const TERM_H = 96;
const GAP_X = 88;
const GAP_Y = 22;
const GOAL_ID = '__wf_goal__';
const RESULT_ID = '__wf_result__';

function statusRing(st: WorkflowNodeState | 'template'): string {
	switch (st) {
		case 'running':
			// No Tailwind shadow here — wf-node--running CSS owns the pulse box-shadow.
			return 'border-sky-500 ring-[3px] ring-sky-400/70';
		case 'blocked':
			return 'border-amber-500 ring-2 ring-amber-500/55';
		case 'done':
			return 'border-emerald-500/75 ring-2 ring-emerald-500/45 opacity-95';
		case 'reject-reopen':
			return 'border-amber-500 ring-2 ring-amber-500/50';
		case 'failed':
			return 'border-destructive ring-2 ring-destructive/50';
		case 'skipped':
			return 'border-dashed border-muted-foreground/30 opacity-40 grayscale';
		case 'pending':
			// Shell already carries shared pending chrome (themeForState) — only soft opacity.
			return 'opacity-65';
		default:
			return '';
	}
}

function statusChip(st: WorkflowNodeState | 'template'): string {
	switch (st) {
		case 'running':
			return 'rounded bg-sky-500/20 px-1 font-semibold text-sky-700 dark:text-sky-300';
		case 'blocked':
			return 'rounded bg-amber-500/20 px-1 font-semibold text-amber-800 dark:text-amber-300';
		case 'done':
			return 'rounded bg-emerald-500/15 px-1 font-semibold text-emerald-700 dark:text-emerald-300';
		case 'reject-reopen':
			return 'rounded bg-amber-500/15 px-1 font-semibold text-amber-800 dark:text-amber-300';
		case 'failed':
			return 'rounded bg-destructive/15 px-1 font-semibold text-destructive';
		case 'skipped':
			return 'font-medium text-muted-foreground';
		case 'pending':
			return 'font-medium text-muted-foreground';
		default:
			return 'font-medium opacity-70';
	}
}

function liveEdgeStyle(
	targetState: WorkflowNodeState | 'template' | undefined,
	fallbackStroke: string
): {
	animated: boolean;
	stroke: string;
	strokeWidth: number;
	opacity: number;
	strokeDasharray?: string;
} {
	switch (targetState) {
		case 'running':
			// Dash flow only on edges into the active node (completed → running).
			// strokeDasharray also set inline so motion is visible even if CSS load order drifts.
			return {
				animated: true,
				stroke: '#0ea5e9',
				strokeWidth: 2.75,
				opacity: 1,
				strokeDasharray: '8 6'
			};
		case 'done':
			return {animated: false, stroke: '#10b981', strokeWidth: 1.75, opacity: 0.55};
		case 'failed':
			return {
				animated: false,
				stroke: '#ef4444',
				strokeWidth: 2,
				opacity: 0.7,
				strokeDasharray: '4 3'
			};
		case 'reject-reopen':
		case 'blocked':
			return {animated: false, stroke: '#f59e0b', strokeWidth: 2, opacity: 0.75};
		case 'pending':
			return {animated: false, stroke: fallbackStroke, strokeWidth: 1.4, opacity: 0.28};
		case 'skipped':
			return {
				animated: false,
				stroke: fallbackStroke,
				strokeWidth: 1.4,
				opacity: 0.22,
				strokeDasharray: '3 4'
			};
		default:
			return {animated: false, stroke: fallbackStroke, strokeWidth: 1.75, opacity: 0.75};
	}
}

function shapeClass(shape: RoleTheme['shape']): string {
	switch (shape) {
		case 'pill':
			return 'rounded-full';
		case 'soft':
			return 'rounded-xl';
		case 'shield':
			return 'rounded-t-xl rounded-b-2xl';
		case 'diamond':
			return 'rounded-xl';
		default:
			return 'rounded-lg';
	}
}

const TerminalNode = memo(function TerminalNode({data}: NodeProps<Node<TerminalData>>) {
	const isGoal = data.kind === 'goal';
	const resultState = data.resultState ?? 'pending';
	const resultShell =
		resultState === 'done'
			? 'rounded-full border-teal-400/60 bg-gradient-to-br from-teal-500/20 via-emerald-500/10 to-background text-teal-950 dark:text-teal-100 shadow-md'
			: resultState === 'failed'
				? 'rounded-full border-destructive/60 bg-gradient-to-br from-destructive/15 to-background text-destructive shadow-md'
				: cn('rounded-full shadow-sm opacity-65', PENDING_SHELL);
	const resultIcon =
		resultState === 'done'
			? 'text-teal-600 dark:text-teal-300'
			: resultState === 'failed'
				? 'text-destructive'
				: 'text-muted-foreground';
	const handleBg =
		resultState === 'done' ? '#14b8a6' : resultState === 'failed' ? '#ef4444' : PENDING_HANDLE;

	return (
		<div
			className={cn(
				'flex flex-col items-center justify-center gap-1 border',
				isGoal
					? 'rounded-2xl border-indigo-400/60 bg-gradient-to-br from-indigo-500/20 via-indigo-500/10 to-background text-indigo-950 shadow-md dark:text-indigo-100'
					: resultShell
			)}
			style={{width: TERM_W, height: TERM_H}}
		>
			{!isGoal ? (
				<Handle
					type="target"
					position={Position.Left}
					className="!size-2.5 !border-2 !border-background"
					style={{background: handleBg}}
				/>
			) : null}
			{isGoal ? (
				<Flag className="size-4 text-indigo-600 dark:text-indigo-300" strokeWidth={2} />
			) : (
				<CheckCircle2 className={cn('size-4', resultIcon)} strokeWidth={2} />
			)}
			<span className="px-2 text-center text-[11px] font-semibold leading-tight">
				{data.label}
			</span>
			{data.subtitle ? (
				<span className="max-w-[80px] truncate px-1 text-[9px] text-muted-foreground">
					{data.subtitle}
				</span>
			) : !isGoal && resultState === 'pending' ? (
				<span className="px-1 text-[9px] text-muted-foreground">{t('shell.workflow.pendingChip')}</span>
			) : null}
			{isGoal ? (
				<Handle
					type="source"
					position={Position.Right}
					className="!size-2.5 !border-2 !border-background !bg-indigo-500"
				/>
			) : null}
		</div>
	);
});

const WfNode = memo(function WfNode({data}: NodeProps<Node<WfNodeData>>) {
	const {theme: roleTheme, state: st} = data;
	const theme = themeForState(roleTheme, st);
	const Icon = theme.Icon;
	const isDiamond = theme.shape === 'diamond' && st !== 'pending' && st !== 'skipped';
	const [settle, setSettle] = useState(false);
	const [rejectFlash, setRejectFlash] = useState(false);
	const prevState = useRef(st);

	useEffect(() => {
		const prev = prevState.current;
		prevState.current = st;
		if (st === 'done' && prev !== 'done') {
			setSettle(true);
			const t = window.setTimeout(() => setSettle(false), 220);
			return () => window.clearTimeout(t);
		}
		if (st === 'reject-reopen' && prev !== 'reject-reopen') {
			setRejectFlash(true);
			const t = window.setTimeout(() => setRejectFlash(false), 700);
			return () => window.clearTimeout(t);
		}
	}, [st]);

	return (
		<div
			className={cn(
				'relative border px-2.5 py-2 backdrop-blur-[2px]',
				shapeClass(theme.shape),
				theme.shell,
				statusRing(st),
				st !== 'running' && st !== 'pending' && st !== 'skipped' && 'shadow-sm',
				isDiamond && st !== 'running' && 'shadow-md',
				st === 'running' && 'wf-node--running',
				settle && 'wf-node--done-settle',
				rejectFlash && 'wf-node--reject-flash'
			)}
			style={{
				width: NODE_W,
				minHeight: NODE_H,
				...(isDiamond
					? {
							clipPath:
								'polygon(12% 0, 88% 0, 100% 50%, 88% 100%, 12% 100%, 0 50%)'
						}
					: {})
			}}
		>
			{st === 'running' ? (
				<>
					<span className="wf-running-ring" aria-hidden />
					<span className="pointer-events-none absolute -right-0.5 -top-0.5 flex size-2.5">
						<span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-75" />
						<span className="relative inline-flex size-2.5 rounded-full bg-sky-500" />
					</span>
				</>
			) : null}
			<Handle
				type="target"
				position={Position.Left}
				className="!size-2 !border-2 !border-background"
				style={{background: theme.handle}}
			/>
			<div className={cn('flex items-start gap-1.5', isDiamond && 'px-1')}>
				<span
					className={cn(
						'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-background/50'
					)}
				>
					<Icon className="size-3 opacity-80" strokeWidth={2} />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex items-start justify-between gap-1">
						<span className="truncate text-[11px] font-semibold leading-snug">
							{data.label}
						</span>
						{st !== 'template' ? (
							<span className={cn('shrink-0 text-[8px]', statusChip(st))}>
								{workflowStatusLabel(st)}
							</span>
						) : null}
					</div>
					{data.subtitle ? (
						<p className="mt-0.5 truncate text-[9px] opacity-60">{data.subtitle}</p>
					) : (
						<p className="mt-0.5 text-[9px] opacity-50">
							{roleTheme.kind === 'moderator'
								? t('shell.workflow.coord')
								: roleTheme.kind === 'verifier'
									? t('shell.teams.roles.verifier')
									: roleTheme.kind === 'executor'
										? t('shell.teams.roles.executor')
										: roleTheme.kind === 'researcher'
											? t('shell.teams.roles.researcher')
											: t('shell.teams.roles.member')}
						</p>
					)}
				</div>
			</div>
			<Handle
				type="source"
				position={Position.Right}
				className="!size-2 !border-2 !border-background"
				style={{background: theme.handle}}
			/>
		</div>
	);
});

const nodeTypes = {
	wf: WfNode,
	wfTerminal: TerminalNode
};

function buildGraph(
	steps: WorkflowStep[],
	mode: 'live' | 'template',
	opts: {
		currentStepIds?: string | string[] | null;
		/** @deprecated wire dual-read — prefer currentStepIds */
		currentStepId?: string | string[] | null;
		completedSteps?: Set<string>;
		pendingExtras?: Set<string>;
		goalStatus?: string | null;
		goalLabel?: string | null;
		resultLabel?: string | null;
	}
): {nodes: Node[]; edges: Edge[]} {
	const layers = workflowLayers(steps);
	const done = opts.completedSteps ?? new Set<string>();
	const extras = opts.pendingExtras ?? new Set<string>();
	const nodes: Node[] = [];
	const themeById = new Map<string, RoleTheme>();
	const stateById = new Map<string, WorkflowNodeState | 'template'>();

	const layerOffset = 1; // Goal occupies column 0
	layers.forEach((layer, li) => {
		const totalH = layer.length * NODE_H + (layer.length - 1) * GAP_Y;
		const startY = -totalH / 2 + NODE_H / 2;
		layer.forEach((step, i) => {
			const idx = steps.indexOf(step);
			const sid = stepKey(step, idx >= 0 ? idx : i);
			const st: WorkflowNodeState | 'template' =
				mode === 'template'
					? 'template'
					: workflowNodeStatus(sid, {
							currentStepIds: opts.currentStepIds,
							currentStepId: opts.currentStepId,
							completedSteps: done,
							pendingExtras: extras,
							goalStatus: opts.goalStatus
						});
			const label = step.use || step.name || sid;
			const role = roleKindOf(step.use, step.name);
			const theme = themeForState(ROLE_THEMES[role], st);
			themeById.set(sid, theme);
			stateById.set(sid, st);
			nodes.push({
				id: sid,
				type: 'wf',
				position: {
					x: (li + layerOffset) * (NODE_W + GAP_X),
					y: startY + i * (NODE_H + GAP_Y)
				},
				data: {
					label,
					subtitle:
						step.name && step.use && step.name !== step.use ? step.name : undefined,
					state: st,
					use: step.use,
					role,
					theme
				} satisfies WfNodeData,
				draggable: false,
				connectable: false
			});
		});
	});

	const colW = NODE_W + GAP_X;
	const lastCol = layers.length; // 0=goal, 1..n=steps, n+1=result
	nodes.unshift({
		id: GOAL_ID,
		type: 'wfTerminal',
		position: {
			x: (TERM_W - NODE_W) / 2,
			y: -TERM_H / 2 + NODE_H / 2
		},
		data: {
			kind: 'goal',
			label: 'Goal',
			subtitle: opts.goalLabel?.trim() || undefined
		} satisfies TerminalData,
		draggable: false,
		connectable: false
	});
	const resultState = mode === 'live' ? resultTerminalState(opts.goalStatus) : 'pending';
	nodes.push({
		id: RESULT_ID,
		type: 'wfTerminal',
		position: {
			x: (lastCol + 1) * colW + (TERM_W - NODE_W) / 2,
			y: -TERM_H / 2 + NODE_H / 2
		},
		data: {
			kind: 'result',
			label: t('shell.workflow.result'),
			subtitle: opts.resultLabel?.trim() || undefined,
			resultState
		} satisfies TerminalData,
		draggable: false,
		connectable: false
	});

	const edges: Edge[] = [];
	const ids = new Set(steps.map((s, i) => stepKey(s, i)));
	const roots = steps
		.map((s, i) => stepKey(s, i))
		.filter(id => {
			const step = steps.find((s, i) => stepKey(s, i) === id);
			const deps = (step?.depends_on ?? []).filter(d => ids.has(d));
			return deps.length === 0;
		});
	const sinks = steps
		.map((s, i) => stepKey(s, i))
		.filter(id => !steps.some(s => (s.depends_on ?? []).includes(id)));

	for (const root of roots) {
		const edge =
			mode === 'live'
				? liveEdgeStyle(stateById.get(root), '#6366f1')
				: {animated: false, stroke: '#6366f1', strokeWidth: 1.75, opacity: 0.75};
		edges.push({
			id: `${GOAL_ID}->${root}`,
			source: GOAL_ID,
			target: root,
			type: 'smoothstep',
			className: edge.animated ? 'wf-edge--flow' : undefined,
			animated: edge.animated,
			markerEnd: {
				type: MarkerType.ArrowClosed,
				width: 14,
				height: 14,
				color: edge.stroke
			},
			style: {
				stroke: edge.stroke,
				strokeWidth: edge.strokeWidth,
				opacity: edge.opacity,
				...(edge.strokeDasharray ? {strokeDasharray: edge.strokeDasharray} : {})
			}
		});
	}

	steps.forEach((step, i) => {
		const sid = stepKey(step, i);
		for (const dep of step.depends_on ?? []) {
			if (!ids.has(dep)) continue;
			const srcTheme = themeById.get(dep) ?? ROLE_THEMES.default;
			const edge =
				mode === 'live'
					? liveEdgeStyle(stateById.get(sid), srcTheme.stroke)
					: {
							animated: false,
							stroke: srcTheme.stroke,
							strokeWidth: 1.75,
							opacity: 0.8
						};
			edges.push({
				id: `${dep}->${sid}`,
				source: dep,
				target: sid,
				type: 'smoothstep',
				className: edge.animated ? 'wf-edge--flow' : undefined,
				animated: edge.animated,
				markerEnd: {
					type: MarkerType.ArrowClosed,
					width: 14,
					height: 14,
					color: edge.stroke
				},
				style: {
					stroke: edge.stroke,
					strokeWidth: edge.strokeWidth,
					opacity: edge.opacity,
					...('strokeDasharray' in edge && edge.strokeDasharray
						? {strokeDasharray: edge.strokeDasharray}
						: {})
				}
			});
		}
	});

	for (const sink of sinks) {
		const sinkRunning = stateById.get(sink) === 'running';
		const sinkDone = stateById.get(sink) === 'done';
		// Match pending-step edge chrome until Result is reached.
		const edge =
			resultState === 'done'
				? {
						animated: false as boolean,
						stroke: '#10b981',
						strokeWidth: 1.75,
						opacity: 0.75,
						strokeDasharray: undefined as string | undefined
					}
				: resultState === 'failed'
					? {
							animated: false,
							stroke: '#ef4444',
							strokeWidth: 2,
							opacity: 0.7,
							strokeDasharray: '4 3' as string | undefined
						}
					: sinkRunning
						? liveEdgeStyle('running', PENDING_STROKE)
						: liveEdgeStyle('pending', PENDING_STROKE);
		const flow = Boolean(edge.animated);
		edges.push({
			id: `${sink}->${RESULT_ID}`,
			source: sink,
			target: RESULT_ID,
			type: 'smoothstep',
			className: flow ? 'wf-edge--flow' : undefined,
			animated: flow,
			markerEnd: {type: MarkerType.ArrowClosed, width: 14, height: 14, color: edge.stroke},
			style: {
				stroke: edge.stroke,
				strokeWidth: edge.strokeWidth,
				opacity: edge.opacity,
				...(edge.strokeDasharray ? {strokeDasharray: edge.strokeDasharray} : {})
			}
		});
	}

	return {nodes, edges};
}

/**
 * Read-only pipeline/DAG via React Flow.
 * Goal → role-colored steps → 结果; same column = parallel.
 */
export function WorkflowReadonly({
	steps,
	mode,
	currentStepIds,
	currentStepId,
	completedSteps,
	pendingExtras,
	goalStatus,
	goalLabel,
	resultLabel,
	onOpenStep,
	className,
	/** Session drawer mini chart — shorter than Teams detail. */
	compact = false
}: {
	steps: WorkflowStep[];
	mode: 'live' | 'template';
	currentStepIds?: string | string[] | null;
	/** @deprecated wire dual-read — prefer currentStepIds */
	currentStepId?: string | string[] | null;
	completedSteps?: Set<string>;
	pendingExtras?: Set<string>;
	goalStatus?: string | null;
	goalLabel?: string | null;
	resultLabel?: string | null;
	onOpenStep?: (use: string, stepId: string) => void;
	className?: string;
	compact?: boolean;
}) {
	const {nodes, edges} = useMemo(
		() =>
			buildGraph(steps, mode, {
				currentStepIds,
				currentStepId,
				completedSteps,
				pendingExtras,
				goalStatus,
				goalLabel,
				resultLabel
			}),
		[
			steps,
			mode,
			currentStepIds,
			currentStepId,
			completedSteps,
			pendingExtras,
			goalStatus,
			goalLabel,
			resultLabel
		]
	);

	const onNodeClick = useCallback(
		(_: unknown, node: Node) => {
			if (node.id === GOAL_ID || node.id === RESULT_ID) return;
			const data = node.data as WfNodeData;
			if (data.use && onOpenStep) onOpenStep(data.use, node.id);
		},
		[onOpenStep]
	);

	if (steps.length === 0) {
		return (
			<p className="px-1 py-3 text-sm text-muted-foreground">
				{mode === 'template' ? t('shell.workflow.noTemplate') : t('shell.workflow.noSnapshot')}
			</p>
		);
	}

	const parallelMax = Math.max(...workflowLayers(steps).map(l => l.length), 1);
	const height = compact
		? Math.max(180, Math.min(240, 120 + parallelMax * 48))
		: Math.max(220, Math.min(360, 140 + parallelMax * 64));

	return (
		<div
			className={cn(
				'workflow-live overflow-hidden rounded-xl border border-border/80 bg-gradient-to-b from-muted/30 to-background shadow-inner',
				compact && 'workflow-live--compact',
				className
			)}
			style={{height}}
		>
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				onNodeClick={onNodeClick}
				fitView
				fitViewOptions={{padding: compact ? 0.16 : 0.22}}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={Boolean(onOpenStep)}
				panOnDrag
				zoomOnScroll={false}
				preventScrolling={false}
				proOptions={{hideAttribution: true}}
				minZoom={0.4}
				maxZoom={1.5}
				defaultEdgeOptions={{
					type: 'smoothstep',
					interactionWidth: 12
				}}
			>
				<Background
					variant={BackgroundVariant.Dots}
					gap={18}
					size={1.2}
					color="color-mix(in oklab, var(--muted-foreground) 28%, transparent)"
				/>
				{compact ? null : (
					<Controls
						showInteractive={false}
						className="!overflow-hidden !rounded-lg !border-border/80 !bg-background/95 !shadow-sm"
					/>
				)}
			</ReactFlow>
		</div>
	);
}
