import {shellT as t} from './i18n/t';
import {useMemo, useCallback} from 'react';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	ReactFlow,
	Background,
	BackgroundVariant,
	Controls,
	MarkerType,
	type Node,
	type Edge
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './workflowLive.css';
import {workflowNodeStatus, type WorkflowNodeState} from './workflowNodeStatus';
import {
	GAP_X,
	GAP_Y,
	GOAL_ID,
	NODE_H,
	NODE_W,
	PENDING_STROKE,
	RESULT_ID,
	ROLE_THEMES,
	TERM_H,
	TERM_W,
	liveEdgeStyle,
	nodeTypes,
	resultTerminalState,
	roleKindOf,
	themeForState,
	type RoleTheme,
	type TerminalData,
	type WfNodeData
} from './workflowNodes';

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
