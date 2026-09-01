import {memo} from 'react';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import type {EdgesList} from '@fast-ide/session-view';
import {useEditorStatus} from './editorStatusStore';
import {cn} from '@fast-ide/ui/lib/utils';
import {Braces, GitBranch, HardDrive} from 'lucide-react';

const LOCAL_EDGE_ID = 'local';

export type StatusBarServer = {
	name: string;
	title: string;
	connecting: boolean;
};

/** Committed server, or the candidate while a switch is in flight. */
export function statusBarServer(
	edges: EdgesList | null | undefined,
	localLabel: string
): StatusBarServer | null {
	if (!edges) return null;
	const id = edges.pendingEdgeId || edges.activeId;
	const connecting = Boolean(edges.pendingEdgeId);
	if (id === LOCAL_EDGE_ID) {
		return {name: localLabel, title: localLabel, connecting};
	}
	const row = edges.servers.find(s => s.id === id);
	const name = row?.name ?? localLabel;
	const title = row ? `${row.name} (${row.ip}:${row.port})` : name;
	return {name, title, connecting};
}

export type StatusBarGit = {
	branch: string;
	dirty: boolean;
} | null;

export type StatusBarEditor = {
	line: number;
	column: number;
	languageLabel: string;
	indentLabel: string;
	encoding: string;
	eol: string;
} | null;

export type EngineStatusKind =
	| 'starting'
	| 'ready'
	| 'reconnecting'
	| 'error'
	| 'exited'
	| null
	| undefined;

function Item({
	children,
	className,
	title,
	onClick
}: {
	children: ReactNode;
	className?: string;
	title?: string;
	onClick?: () => void;
}) {
	const classNames = cn(
		'inline-flex h-full max-w-[14rem] items-center gap-1 truncate px-2 text-[11px] text-muted-foreground',
		onClick && 'hover:bg-muted hover:text-foreground',
		className
	);
	if (onClick) {
		return (
			<button type="button" title={title} onClick={onClick} className={classNames}>
				{children}
			</button>
		);
	}
	return (
		<div title={title} className={classNames}>
			{children}
		</div>
	);
}

function engineLampClass(status: EngineStatusKind): string {
	switch (status) {
		case 'ready':
			return 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.85)]';
		case 'starting':
		case 'reconnecting':
			return 'bg-amber-400 animate-pulse shadow-[0_0_6px_rgba(251,191,36,0.75)]';
		case 'error':
		case 'exited':
			return 'bg-destructive shadow-[0_0_6px_rgba(239,68,68,0.75)]';
		default:
			return 'bg-zinc-400';
	}
}

function engineLabel(status: EngineStatusKind): string {
	switch (status) {
		case 'ready':
			return 'Engine ready';
		case 'starting':
			return 'Engine starting…';
		case 'reconnecting':
			return 'Engine reconnecting…';
		case 'error':
		case 'exited':
			return 'Engine Error';
		default:
			return 'Engine offline';
	}
}

/** Compact Engine status lamp for status bar / sidebar footer. */
export function EngineStatusLamp({
	status,
	error,
	showLabel = true,
	className
}: {
	status?: EngineStatusKind;
	error?: string | null;
	showLabel?: boolean;
	className?: string;
}) {
	const label = engineLabel(status);
	const title = error?.trim() ? `${label}: ${error}` : label;
	return (
		<div
			title={title}
			aria-label={title}
			className={cn(
				'inline-flex items-center gap-1.5 text-[11px] text-muted-foreground',
				className
			)}
		>
			<span
				aria-hidden
				className={cn('size-2.5 shrink-0 rounded-full', engineLampClass(status))}
			/>
			{showLabel ? <span className="truncate">{label}</span> : null}
		</div>
	);
}

/**
 * VS Code / Cursor–style bottom status bar.
 * Left: workspace / git; right: editor, model, server, Engine lamp (far right).
 */
function StatusBarImpl({
	projectName,
	engineStatus,
	engineError,
	git,
	modelDisplay,
	edges,
	runState = 'idle',
	editorVisible = false,
	onRetryEngine,
	className
}: {
	projectName?: string | null;
	engineStatus?: EngineStatusKind;
	engineError?: string | null;
	git?: StatusBarGit;
	modelDisplay?: string | null;
	edges?: EdgesList | null;
	runState?: 'idle' | 'running' | 'stopping';
	/** Right rail open — cursor status subscribes here, not through App (P2-14). */
	editorVisible?: boolean;
	/** Shown when Engine is error/exited — in-shell Retry (no return to landing). */
	onRetryEngine?: () => void;
	className?: string;
}) {
	const {t} = useTranslation();
	// Monaco cursor moves re-render only this bar.
	const cursor = useEditorStatus();
	const editor: StatusBarEditor = editorVisible && cursor ? cursor : null;
	const server = statusBarServer(edges, t('shell.sidebar.localEdge'));
	const connecting = t('shell.sidebar.connecting');
	const label = engineLabel(engineStatus);
	const title = engineError?.trim() ? `${label}: ${engineError}` : label;
	const canRetry =
		Boolean(onRetryEngine) &&
		(engineStatus === 'error' || engineStatus === 'exited');

	return (
		<footer
			role="status"
			aria-label="Status bar"
			className={cn(
				'flex h-7 shrink-0 items-stretch justify-between border-t border-border bg-muted select-none',
				className
			)}
		>
			<div className="flex min-w-0 items-stretch">
				{git ? (
					<Item title={git.dirty ? `${git.branch} (uncommitted changes)` : git.branch}>
						<GitBranch className="size-3 shrink-0" aria-hidden />
						<span className="truncate">
							{git.branch}
							{git.dirty ? '*' : ''}
						</span>
					</Item>
				) : null}

				{projectName ? (
					<Item title={projectName}>
						<span className="truncate">{projectName}</span>
					</Item>
				) : null}

				{runState === 'stopping' ? (
					<Item className="text-foreground">
						<span className="truncate">Stopping…</span>
					</Item>
				) : runState === 'running' ? (
					<Item className="text-foreground">
						<span className="truncate">Running…</span>
					</Item>
				) : null}
			</div>

			<div className="flex min-w-0 items-stretch justify-end">
				{editor ? (
					<>
						<Item title="Cursor position">
							<span className="tabular-nums">
								Ln {editor.line}, Col {editor.column}
							</span>
						</Item>
						<Item title="Indentation">
							<span>{editor.indentLabel}</span>
						</Item>
						<Item title="Encoding">
							<span>{editor.encoding}</span>
						</Item>
						<Item title="End of line">
							<span>{editor.eol}</span>
						</Item>
						<Item title="Language mode">
							<Braces className="size-3 shrink-0" aria-hidden />
							<span className="truncate">{editor.languageLabel}</span>
						</Item>
					</>
				) : null}

				{modelDisplay && modelDisplay.trim().toLowerCase() !== 'default' ? (
					<Item title={`Model: ${modelDisplay}`}>
						<span className="truncate">{modelDisplay}</span>
					</Item>
				) : null}

				{server ? (
					<Item
						title={
							server.connecting ? `${server.title} — ${connecting}` : server.title
						}
					>
						<HardDrive className="size-3 shrink-0" aria-hidden />
						<span className="truncate">
							{server.name}
							{server.connecting ? ` · ${connecting}` : ''}
						</span>
					</Item>
				) : null}

				{canRetry ? (
					<button
						type="button"
						title={`${title} — click to retry`}
						aria-label={`Engine Error. Retry. ${engineError ?? ''}`.trim()}
						onClick={() => onRetryEngine?.()}
						className={cn(
							'inline-flex items-center gap-1.5 px-2 text-[11px] font-medium',
							'bg-destructive/15 text-destructive hover:bg-destructive/25'
						)}
					>
						<span
							aria-hidden
							className={cn('size-2.5 shrink-0 rounded-full', engineLampClass(engineStatus))}
						/>
						<span className="truncate">{label}</span>
						<span className="opacity-80">· Retry</span>
					</button>
				) : (
					<Item
						title={title}
						className={cn(
							'gap-1.5 font-medium text-foreground',
							(engineStatus === 'error' || engineStatus === 'exited') &&
								'bg-destructive/15 text-destructive'
						)}
					>
						<span
							aria-hidden
							className={cn('size-2.5 shrink-0 rounded-full', engineLampClass(engineStatus))}
						/>
						<span className="truncate">{label}</span>
					</Item>
				)}
			</div>
		</footer>
	);
}

/** Memo boundary (perf doc P0-3): scalar props — skip streaming-frame re-renders. */
export const StatusBar = memo(StatusBarImpl);
