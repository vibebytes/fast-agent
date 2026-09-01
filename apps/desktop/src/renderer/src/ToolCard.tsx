import {shellT as t} from './i18n/t';
import {useEffect, useState, type ReactNode} from 'react';
import {WindowFrame} from '@fast-ide/ui/components/window-frame';
import {cn} from '@fast-ide/ui/lib/utils';
import type {TimelineItem} from '@fast-ide/session-view';
import {Boxes, Check, Copy, FileText, LoaderCircle, X} from 'lucide-react';
import {highlightCode} from './highlightCode';
import {
	extractImagePath,
	ProjectImage,
	StreamingMarkdownMessage
} from './MarkdownMessage';
import {shouldThresholdFoldTool} from './thresholdFold';
import {
	displayToolOutput,
	isSkillView,
	isSubagentTool,
	parseSkillEnvelope,
	parseSubagentPayload,
	skillViewName
} from './toolPresentation';

type ToolItem = Extract<TimelineItem, {kind: 'tool'}>;

function StatusIcon({
	status,
	exitCode,
	note
}: {
	status: ToolItem['status'];
	exitCode?: string | null;
	note?: string;
}) {
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
	if (status === 'error') {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">
				{exitCode != null && exitCode !== '' ? (
					<span className="font-mono tabular-nums">exit {exitCode}</span>
				) : null}
				<X className="size-3" aria-label={t('shell.toolCard.failed')} strokeWidth={2.5} />
			</span>
		);
	}
	if (status === 'cancelled') {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
				<X className="size-3" aria-label={t('shell.toolCard.cancelled')} strokeWidth={2.5} />
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
			{exitCode != null && exitCode !== '' ? (
				<span className="font-mono tabular-nums">exit {exitCode}</span>
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

/** Lightweight keyword tint for common shell log lines (WARN / error / Done) & file path links. */
function tintOutputLine(line: string): ReactNode {
	if (!line || line.trim() === '') return ' ';

	const fileMatch = /^(\s*)([a-zA-Z0-9_.\-\/\\]+\.[a-zA-Z0-9]+)(:\d+(?::\d+)?:?)(.*)$/.exec(line);
	if (fileMatch) {
		const [, indent, filePath, lineCol, rest] = fileMatch;
		return (
			<>
				{indent}
				<span className="font-medium text-foreground/90">{filePath}</span>
				<span className="font-mono text-primary/80">{lineCol}</span>
				{rest ? tintOutputLine(rest) : null}
			</>
		);
	}

	if (/^\s*WARN(?:ING)?\b/i.test(line) || /\bWARN\b/.test(line)) {
		return <span className="text-amber-700 dark:text-amber-400">{line}</span>;
	}
	if (/^\s*(?:ERROR|ERR|FAIL(?:ED)?)\b/i.test(line) || (/\berror\b/i.test(line) && /failed/i.test(line))) {
		return <span className="text-red-600 dark:text-red-400">{line}</span>;
	}
	if (/^\s*Done\b/i.test(line) || /\bsuccess\b/i.test(line)) {
		return <span className="text-emerald-700 dark:text-emerald-400">{line}</span>;
	}
	if (/^\s*\+\d+/.test(line) || /\+\+$/.test(line.trim())) {
		return <span className="text-emerald-600 dark:text-emerald-400">{line}</span>;
	}
	return line;
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

function isImageTool(tool: string): boolean {
	return /image|img|nano.?banana|dall|flux|midjourney/i.test(tool);
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
			tone={item.status === 'error' ? 'error' : undefined}
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
			trailing={<StatusIcon status={item.status} exitCode={item.exitCode} />}
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
			tone={item.status === 'error' ? 'error' : undefined}
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
				<StatusIcon status={item.status} exitCode={item.exitCode} note={item.statusNote} />
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

	const output = displayToolOutput(item.output);
	const displayItem = output === (item.output ?? '') ? item : {...item, output};
	const imagePath =
		extractImagePath(output) ??
		extractImagePath(item.summary) ??
		(isImageTool(item.tool) ? extractImagePath(item.title) : null);
	const thresholdFold = shouldThresholdFoldTool(displayItem);
	// Successful tool cards settle to their one-line header (shell commands and
	// non-command tools like goal). Running / failed keep evidence visible.
	const isAgentOp =
		item.tool === 'define_agent' || item.tool === 'update_agent' || item.tool === 'delete_agent';
	const collapsible = isAgentOp || thresholdFold || item.status === 'success';
	const defaultOpen = isAgentOp ? false : (item.status === 'running' || item.status === 'error');

	return (
		<WindowFrame
			variant="terminal"
			tone={item.status === 'error' ? 'error' : undefined}
			title={item.title}
			titleShimmer={item.status === 'running'}
			trailing={<StatusIcon status={item.status} exitCode={item.exitCode} />}
			collapsible={collapsible}
			defaultOpen={defaultOpen}
			className="w-full"
		>
			{item.command ? <CommandLine command={item.command} /> : null}
			{imagePath ? (
				<div className="border-b border-border px-2 py-2">
					<ProjectImage src={imagePath} alt={item.title} className="my-0" />
				</div>
			) : null}
			{output ? (
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
			) : item.status === 'running' && !item.output && !imagePath ? (
				<div className="px-3 py-2 text-xs text-muted-foreground">Running…</div>
			) : null}
		</WindowFrame>
	);
}
