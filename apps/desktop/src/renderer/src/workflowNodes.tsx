import {shellT as t} from './i18n/t';
import {memo, useEffect, useRef, useState} from 'react';
import {Handle, Position, type Node, type NodeProps} from '@xyflow/react';
import {cn} from '@fast-ide/ui/lib/utils';
import {CheckCircle2, Flag, ShieldCheck, Sparkles, Users, Wrench} from 'lucide-react';
import {workflowStatusLabel} from './teamsDisplay';
import {type WorkflowNodeState} from './workflowNodeStatus';

export type RoleKind = 'moderator' | 'verifier' | 'executor' | 'researcher' | 'default';

export type RoleTheme = {
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

export const ROLE_THEMES: Record<RoleKind, RoleTheme> = {
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
export const PENDING_STROKE = '#94a3b8';
const PENDING_HANDLE = '#94a3b8';

export function themeForState(theme: RoleTheme, st: WorkflowNodeState | 'template'): RoleTheme {
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

export type ResultTerminalState = 'pending' | 'done' | 'failed';

export function resultTerminalState(goalStatus?: string | null): ResultTerminalState {
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

export function roleKindOf(use?: string, name?: string): RoleKind {
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

export type TerminalData = {
	label: string;
	subtitle?: string;
	kind: 'goal' | 'result';
	/** Result only — matches pending step chrome until Goal finishes. */
	resultState?: ResultTerminalState;
};

export type WfNodeData = {
	label: string;
	subtitle?: string;
	state: WorkflowNodeState | 'template';
	use?: string;
	role: RoleKind;
	theme: RoleTheme;
};

export const NODE_W = 132;
export const NODE_H = 52;
export const TERM_W = 96;
export const TERM_H = 96;
export const GAP_X = 88;
export const GAP_Y = 22;
export const GOAL_ID = '__wf_goal__';
export const RESULT_ID = '__wf_result__';

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

export function liveEdgeStyle(
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

export const nodeTypes = {
	wf: WfNode,
	wfTerminal: TerminalNode
};

