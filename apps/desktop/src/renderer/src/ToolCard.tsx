import {shellT as t} from './i18n/t';
import {useEffect, useState, type ReactNode} from 'react';
import {WindowFrame} from '@fast-ide/ui/components/window-frame';
import {cn} from '@fast-ide/ui/lib/utils';
import type {TimelineItem} from '@fast-ide/session-view';
import {readArtifact, stripArtifact} from '@fast-ide/session-view';
import {Boxes, Check, ChevronDown, Copy, FileText, LoaderCircle} from 'lucide-react';
import {highlightCode} from './highlightCode';
import {ArtifactCard} from './ArtifactCard';
import {tintOutputLine} from './outputTint';
import {ToolOutputPreview} from './ToolOutputPreview';
import {StreamingMarkdownMessage} from './MarkdownMessage';
import {MediaStage} from './MediaStage';
import {extractMediaArtifact} from './toolMedia';
import {shouldThresholdFoldTool} from './thresholdFold';
import {
	classifyToolOutcome,
	displayToolOutput,
	isSkillView,
	isSubagentTool,
	parseShellEnvelope,
	parseSkillEnvelope,
	parseSubagentPayload,
	shortProcLogPath,
	skillViewName,
	type ShellEnvelopeMeta
} from './toolPresentation';

type ToolItem = Extract<TimelineItem, {kind: 'tool'}>;

function StatusIcon({
	status,
	exitCode,
	output,
	summary,
	note
}: {
	status: ToolItem['status'];
	exitCode?: string | null;
	output?: string | null;
	summary?: string | null;
	note?: string;
}) {
	const outcome = classifyToolOutcome({status, exitCode, output, summary});
	if (status === 'running') {
		const label = note?.trim() || 'Running…';
		return (
			<span
				className="inline-flex max-w-[14rem] items-center gap-1.5 text-[11px] font-medium text-muted-foreground"
				title={label}
			>
				<LoaderCircle
					className="size-3.5 shrink-0 animate-spin text-primary [will-change:transform]"
					aria-label={t('shell.toolCard.running')}
				/>
				<span className="truncate">{label}</span>
			</span>
		);
	}
	if (outcome.tone === 'error') {
		return (
			<span
				className="inline-flex items-center gap-1.5 text-[11px] font-medium text-red-600/90 dark:text-red-400/90"
				title={outcome.exitCode ? `exit ${outcome.exitCode}` : t('shell.toolCard.failed')}
			>
				<span aria-hidden className="size-1.5 shrink-0 rounded-full bg-red-500/80" />
				<span className="font-mono tabular-nums">
					{outcome.exitCode ? `exit ${outcome.exitCode}` : t('shell.toolCard.failed')}
				</span>
			</span>
		);
	}
	if (outcome.label === 'cancelled') {
		return (
			<span
				className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/70"
				title={t('shell.toolCard.cancelled')}
			>
				<span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
				<span className="truncate">{t('shell.toolCard.cancelled')}</span>
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 text-[11px] text-emerald-600/80 dark:text-emerald-400/80">
			{outcome.exitCode ? (
				<span className="font-mono tabular-nums">exit {outcome.exitCode}</span>
			) : null}
			<Check className="size-3" aria-label={t('shell.toolCard.success')} strokeWidth={2.5} />
		</span>
	);
}

function CommandLine({command}: {command: string}) {
	const [html, setHtml] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const source = `$ ${command}`;

	useEffect(() => {
		let cancelled = false;
		void highlightCode(source, 'bash').then(next => {
			if (!cancelled) setHtml(next);
		});
		return () => {
			cancelled = true;
		};
	}, [source]);

	const handleCopy = (e: React.MouseEvent) => {
		e.stopPropagation();
		void navigator.clipboard.writeText(command);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<div className="group/cmd relative border-b border-border/50 bg-muted/20 dark:bg-muted/10 transition-colors hover:bg-muted/30">
			{html ? (
				<div
					className={cn(
						'markdown-shiki',
						'[&_pre]:m-0 [&_pre]:bg-transparent! [&_pre]:px-3 [&_pre]:py-2 [&_pre]:pr-9 [&_pre]:text-[12px] [&_pre]:leading-5 [&_pre]:whitespace-pre-wrap [&_pre]:break-all [&_code]:font-mono [&_code]:text-[12px]'
					)}
					dangerouslySetInnerHTML={{__html: html}}
				/>
			) : (
				<pre className="px-3 py-2 pr-9 font-mono text-[12px] leading-5 whitespace-pre-wrap break-all text-foreground">
					<span className="text-muted-foreground">$ </span>
					{command}
				</pre>
			)}
			<button
				type="button"
				onClick={handleCopy}
				className={cn(
					'absolute top-1.5 right-2 z-10 flex size-6 cursor-pointer items-center justify-center rounded-md',
					'bg-background/80 text-muted-foreground shadow-xs border border-border/40',
					'opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover/cmd:opacity-100',
					copied && 'opacity-100 text-emerald-600 dark:text-emerald-400'
				)}
				title={t('shell.toolCard.copyCommand')}
				aria-label={t('shell.toolCard.copyCommand')}
			>
				{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
			</button>
		</div>
	);
}

function ToolOutput({output}: {output: string}) {
	const lines = output.replace(/\n$/, '').split('\n');
	return (
		// data-scrollable (刀 3-4/刀 4): inner wheel scrolls the output, never exits follow.
		<pre
			data-scrollable
			className="max-h-56 overflow-auto px-3 py-2 font-mono text-[12px] leading-5 text-muted-foreground whitespace-pre-wrap break-all"
		>
			{lines.map((line, i) => (
				<span key={i} className="block">
					{tintOutputLine(line.length === 0 ? ' ' : line)}
				</span>
			))}
		</pre>
	);
}

function MonoChip({
	value,
	title,
	className,
	children
}: {
	value: string;
	title: string;
	className?: string;
	children: ReactNode;
}) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			onClick={e => {
				e.stopPropagation();
				void navigator.clipboard.writeText(value);
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			}}
			title={title}
			aria-label={title}
			className={cn(
				'inline-flex min-w-0 max-w-[18rem] cursor-pointer items-center gap-1 rounded border border-border/40 bg-muted/20 px-1.5 py-px font-mono text-[11px] leading-4 text-muted-foreground transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground',
				copied && 'text-emerald-600 dark:text-emerald-400',
				className
			)}
		>
			{copied ? <Check className="size-3 shrink-0" strokeWidth={2.5} /> : null}
			{children}
		</button>
	);
}

/**
 * Lean ribbon replacing raw ShellEnvelope JSON dumps (background `shell` starts,
 * `shell_wait` results with no preview): one status row — dot · state · procId
 * chip · log chip · exit — plus an on-demand preview fold. Never taller than the
 * JSON blob it replaces while collapsed.
 */
function ProcEnvelopeView({env}: {env: ShellEnvelopeMeta}) {
	const [open, setOpen] = useState(false);
	const running = env.status === 'running';
	const killed = env.status === 'killed';
	const failed = env.exitCode != null && env.exitCode !== 0;
	const preview = (env.outputPreview ?? '').replace(/\n$/, '');
	const shortId = env.procId ? (env.procId.length > 8 ? env.procId.slice(0, 8) : env.procId) : null;

	const statusLabel = running
		? t('shell.toolCard.procRunning')
		: killed
			? t('shell.toolCard.procKilled')
			: env.status === 'exited' || env.exitCode != null
				? t('shell.toolCard.procExited')
				: env.status;

	return (
		<div className="px-3 py-2">
			<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-muted-foreground">
				<span
					className="inline-flex shrink-0 items-center gap-1.5 font-medium"
					title={env.reason ?? undefined}
				>
					<span
						aria-hidden
						className={cn(
							'size-1.5 rounded-full',
							running && 'animate-pulse bg-primary',
							!running && (failed ? 'bg-red-500' : killed ? 'bg-muted-foreground/50' : 'bg-emerald-500')
						)}
					/>
					{statusLabel}
				</span>
				{shortId ? (
					<MonoChip value={env.procId!} title={t('shell.toolCard.copyProcId')}>
						<span className="truncate">#{shortId}</span>
					</MonoChip>
				) : null}
				{env.outFile ? (
					<MonoChip value={env.outFile} title={t('shell.toolCard.copyLogPath')}>
						<FileText className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
						<span className="truncate">{shortProcLogPath(env.outFile)}</span>
					</MonoChip>
				) : null}
				{failed ? (
					<span className="shrink-0 font-mono tabular-nums text-red-600 dark:text-red-400">
						exit {env.exitCode}
					</span>
				) : null}
				{preview ? (
					<button
						type="button"
						onClick={e => {
							e.stopPropagation();
							setOpen(v => !v);
						}}
						aria-label={open ? t('shell.toolCard.hideOutput') : t('shell.toolCard.showOutput')}
						aria-expanded={open}
						title={open ? t('shell.toolCard.hideOutput') : t('shell.toolCard.showOutput')}
						className="ml-auto inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-muted/40 hover:text-foreground"
					>
						<ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
					</button>
				) : null}
			</div>
			{open && preview ? (
				<pre
					data-scrollable
					className="mt-1.5 max-h-44 overflow-auto border-t border-border/40 pt-1.5 font-mono text-[11px] leading-4 text-muted-foreground whitespace-pre-wrap break-all"
				>
					{preview.split('\n').map((line, i) => (
						<span key={i} className="block">
							{tintOutputLine(line.length === 0 ? ' ' : line)}
						</span>
					))}
				</pre>
			) : null}
		</div>
	);
}

function SkillViewCard({item}: {item: ToolItem}) {
	const output = displayToolOutput(item.output);
	const {meta, body} = parseSkillEnvelope(output);
	const name = skillViewName(item.summary, item.output) ?? meta.name;
	const emptyLabel =
		item.status === 'running'
			? 'Loading skill context…'
			: item.status === 'error'
				? 'Skill context unavailable.'
				: item.status === 'cancelled'
					? 'Skill loading stopped.'
					: 'Skill context loaded.';

	const hasMeta = Boolean(meta.location || meta.resources.length > 0);

	return (
		<WindowFrame
			variant="editor"
			leading={
				<Boxes
					className="relative z-[1] size-3.5 shrink-0 text-muted-foreground"
					aria-hidden
				/>
			}
			title={
				<span className="flex min-w-0 items-center gap-1.5 font-normal text-muted-foreground">
					<span>Skill</span>
					{name ? (
						<>
							<span>·</span>
							<span className="truncate font-medium text-foreground">{name}</span>
						</>
					) : null}
				</span>
			}
			titleShimmer={item.status === 'running'}
			trailing={
				<StatusIcon
					status={item.status}
					exitCode={item.exitCode}
					output={item.output}
					summary={item.summary}
				/>
			}
			collapsible
			defaultOpen={item.status === 'running'}
			bodyClassName="bg-background"
			className="w-full"
		>
			<div data-scrollable className="max-h-80 overflow-auto px-3.5 py-2.5">
				{hasMeta ? (
					<div className="mb-2.5 flex flex-wrap items-center gap-1.5 border-b border-border/40 pb-2 text-[11px] text-muted-foreground">
						{meta.location ? (
							<span
								className="max-w-full truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground/90"
								title={meta.location}
							>
								{meta.location}
							</span>
						) : null}
						{meta.resources.map(file => (
							<span
								key={file}
								className="inline-flex items-center gap-1 rounded border border-border/40 bg-muted/20 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80"
							>
								<FileText className="size-3 text-muted-foreground/70" />
								{file}
							</span>
						))}
					</div>
				) : null}

				{body ? (
					<StreamingMarkdownMessage
						text={body}
						streaming={item.status === 'running'}
						className={cn(
							'text-[12px] leading-relaxed tracking-normal',
							'[&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5',
							'[&_h1]:mb-1.5 [&_h1]:mt-2.5 [&_h1]:text-[13.5px] [&_h1]:font-semibold [&_h1]:leading-5',
							'[&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-[12.5px] [&_h2]:font-semibold [&_h2]:leading-4',
							'[&_h3]:mb-1 [&_h3]:mt-1.5 [&_h3]:text-[12px] [&_h3]:font-semibold',
							'[&_hr]:my-2',
							'[&_blockquote]:my-2 [&_blockquote]:py-0.5 [&_blockquote]:pl-2.5',
							'[&_code]:px-1 [&_code]:text-[0.82em]'
						)}
					/>
				) : (
					<div className="py-1 text-[12px] text-muted-foreground">{emptyLabel}</div>
				)}
			</div>
		</WindowFrame>
	);
}

function SubagentCard({item}: {item: ToolItem}) {
	// `output` carries the subagent's live message stream while running (assistant
	// deltas routed by agentRunId) and the result summary once finished — it is the
	// card body. The delegation payload (name/prompt/tools) only lives in args-derived
	// fields, never in output.
	const output = displayToolOutput(item.output);
	const parsed = parseSubagentPayload(item.command ?? item.summary);

	const subagentName =
		item.tool.startsWith('agent: ')
			? item.tool.slice(7).trim()
			: parsed.name ?? 'subagent';

	// Only a real delegation prompt — never raw args JSON like {"name":"analyst"}.
	const promptText = parsed.prompt ?? '';
	const promptLine = promptText.replace(/\s+/g, ' ').trim();

	return (
		<WindowFrame
			variant="editor"
			leading={
				<Boxes
					className="relative z-[1] size-3.5 shrink-0 text-muted-foreground"
					aria-hidden
				/>
			}
			title={
				<span className="flex min-w-0 items-center gap-1.5 font-normal text-muted-foreground">
					<span>Subagent</span>
					<span>·</span>
					<span className="truncate font-medium text-foreground">{subagentName}</span>
				</span>
			}
			titleShimmer={item.status === 'running'}
			trailing={
				<StatusIcon
					status={item.status}
					exitCode={item.exitCode}
					output={item.output}
					summary={item.summary}
					note={item.statusNote}
				/>
			}
			collapsible
			defaultOpen={false}
			bodyClassName="bg-background"
			className="w-full"
		>
			<div data-scrollable className="max-h-80 overflow-auto px-3.5 py-2.5 space-y-2">
				{parsed.tools && parsed.tools.length > 0 ? (
					<div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
						<span className="font-medium text-muted-foreground/80">Capabilities:</span>
						{parsed.tools.map(t => (
							<span
								key={t}
								className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80"
							>
								{t}
							</span>
						))}
					</div>
				) : null}

				{output ? (
					<>
						{promptLine ? (
							<div
								className="truncate border-b border-border/40 pb-1.5 text-[11px] text-muted-foreground"
								title={promptText}
							>
								任务：{promptLine}
							</div>
						) : null}
						{/* Live feed is tool/log + prose tail — same mono log chrome as ToolOutput /
						    BackgroundTools. Markdown would bold `__pycache__` and inflate headings. */}
						<pre className="font-mono text-[11px] leading-snug text-muted-foreground whitespace-pre-wrap break-all">
							{output
								.replace(/\n$/, '')
								.split('\n')
								.map((line, i) => (
									<span key={i} className="block">
										{tintOutputLine(line.length === 0 ? ' ' : line)}
									</span>
								))}
						</pre>
					</>
				) : promptText ? (
					<pre className="whitespace-pre-wrap font-mono text-[11px] leading-snug text-muted-foreground">
						{promptText}
					</pre>
				) : (
					<div className="py-1 text-[11px] text-muted-foreground">
						{item.status === 'running'
							? (item.statusNote ?? 'Running subagent…')
							: item.status === 'cancelled'
								? 'Subagent cancelled.'
								: item.status === 'error'
									? 'Subagent failed.'
									: 'Subagent finished.'}
					</div>
				)}
			</div>
		</WindowFrame>
	);
}

export function ToolCard({item}: {item: ToolItem}) {
	if (isSkillView(item.tool)) return <SkillViewCard item={item} />;
	if (isSubagentTool(item.tool)) return <SubagentCard item={item} />;

	const raw = displayToolOutput(item.output);
	const artifact = readArtifact(raw);
	const output = artifact ? stripArtifact(raw) : raw;
	const shellEnv = parseShellEnvelope(output);
	const displayItem = raw === (item.output ?? '') ? item : {...item, output: raw};
	const media = extractMediaArtifact(output, item.summary, item.title);
	const thresholdFold = shouldThresholdFoldTool(displayItem);
	// Successful tool cards settle to their one-line header (shell commands and
	// non-command tools like goal). Running / failed keep evidence visible.
	const isAgentOp =
		item.tool === 'define_agent' || item.tool === 'update_agent' || item.tool === 'delete_agent';
	const collapsible = isAgentOp || thresholdFold || item.status === 'success' || item.status === 'error';
	const defaultOpen = media != null || artifact != null || (isAgentOp ? false : item.status === 'running');
	// Only problem or verbose cards owe a preview: quiet successes stay one line.
	const wantsPreview = shellEnv != null || (!isAgentOp && (item.status === 'error' || thresholdFold));
	const previewSource = wantsPreview ? (shellEnv?.outputPreview ?? output) : '';

	return (
		<WindowFrame
			variant="terminal"
			title={item.title}
			preview={previewSource ? <ToolOutputPreview output={previewSource} /> : undefined}
			titleShimmer={item.status === 'running'}
			trailing={
				<StatusIcon
					status={item.status}
					exitCode={item.exitCode}
					output={item.output}
					summary={item.summary}
				/>
			}
			collapsible={collapsible}
			defaultOpen={defaultOpen}
			className="w-full"
		>
			{item.command ? <CommandLine command={item.command} /> : null}
			{artifact ? (
				<div className="border-b border-border px-3 py-2">
					<ArtifactCard spec={artifact} />
				</div>
			) : null}
			{media ? (
				<div className="border-b border-border">
					<MediaStage artifact={media} alt={item.title} />
				</div>
			) : null}
			{shellEnv ? (
				<ProcEnvelopeView env={shellEnv} />
			) : output ? (
				<ToolOutput output={output} />
			) : item.summary && !item.command ? (
				<pre
					data-scrollable
					className={cn(
						'max-h-40 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-5',
						'text-muted-foreground whitespace-pre-wrap break-all'
					)}
				>
					{item.summary}
				</pre>
			) : item.status === 'running' && !item.output && !media ? (
				<div className="px-3 py-2 text-xs text-muted-foreground">Running…</div>
			) : null}
		</WindowFrame>
	);
}
