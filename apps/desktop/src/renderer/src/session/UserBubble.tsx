import {useState, type ReactNode} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {Boxes, ChevronDown, ChevronUp, RefreshCw, Square} from 'lucide-react';
import {parseUserSkillDisplay} from '../slashCatalog';
import {MentionText} from '../MentionText';

/** Composer-matching skill pill chrome. */
const SYSTEM_BLUE_CHIP =
	'bg-[#007AFF]/10 text-[#007AFF] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]';

/** Long bodies clamp to ~4 lines; Expand / Collapse sit under the body. */
const LONG_BODY_CHARS = 320;
const PREVIEW_LINES = 'line-clamp-4';

function isLongBody(text: string): boolean {
	return text.length >= LONG_BODY_CHARS || text.split('\n').length > 5;
}

function stopCurrentRun() {
	void window.fastIde.cancelRun();
}

/** Composer-matching skill pill (name kebab kept as Catalog id label). */
function SkillChip({name}: {name: string}) {
	return (
		<span
			className={cn(
				'inline-flex max-w-[min(100%,20rem)] shrink-0 items-center gap-1.5 align-middle',
				'rounded-md px-2 py-0.5 text-[13px] font-medium',
				SYSTEM_BLUE_CHIP
			)}
		>
			<Boxes className="size-3.5 shrink-0" />
			<span className="truncate">{name}</span>
		</span>
	);
}

/** D10 regenerate slot threaded through the user-row shells. */
type RegenSlot = {runId: string; label: string; onRegenerate: (runId: string) => void};

/** Hover regenerate chip — takes the row-right slot where Restore used to live. */
function RegenChip({runId, label, onRegenerate}: RegenSlot) {
	return (
		<button
			type="button"
			className={cn(
				'group/regen pointer-events-none absolute top-1/2 right-2 z-10 inline-flex h-6 -translate-y-1/2 cursor-pointer items-center gap-1',
				'rounded-md border border-border/40 bg-background/80 px-2 text-[11px] font-medium text-muted-foreground shadow-2xs backdrop-blur-sm',
				'transition-all duration-150 hover:border-border/60 hover:bg-background hover:text-foreground',
				'opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
				'group-hover/msg:pointer-events-auto group-hover/msg:opacity-100'
			)}
			title={label}
			aria-label={label}
			onClick={() => onRegenerate(runId)}
		>
			<RefreshCw className="size-3 transition-transform duration-300 ease-out group-hover/regen:-rotate-180" />
			{label}
		</button>
	);
}

/** Same shell as plain user messages: full-width rounded-2xl bubble. */
function UserMessageShell({
	canCancel,
	regen,
	children,
	className,
	/** Flatten bottom when Build Dock adheres below. */
	dockedBelow
}: {
	canCancel: boolean;
	regen?: RegenSlot;
	children: ReactNode;
	className?: string;
	dockedBelow?: boolean;
}) {
	return (
		<MessageStopHost
			canCancel={canCancel}
			className={cn('w-full bg-background', dockedBelow ? 'py-0' : 'py-1')}
		>
			<div
				className={cn(
					'w-full border-0 bg-muted/70',
					dockedBelow ? 'rounded-t-2xl rounded-b-none' : 'rounded-2xl',
					'px-4 py-3 text-[15px] leading-[1.65] text-foreground wrap-break-word',
					canCancel && 'pr-12',
					className
				)}
			>
				{children}
			</div>
			{regen ? <RegenChip {...regen} /> : null}
		</MessageStopHost>
	);
}

function BodyToggle({
	expanded,
	onToggle
}: {
	expanded: boolean;
	onToggle: () => void;
}) {
	const Icon = expanded ? ChevronUp : ChevronDown;
	return (
		<button
			type="button"
			className={cn(
				'mt-2 ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
				'border border-border/40 bg-background/70 text-muted-foreground hover:bg-background hover:text-foreground transition-colors shadow-2xs'
			)}
			onClick={onToggle}
		>
			<Icon className="size-3 shrink-0" />
			{expanded ? 'Collapse' : 'Expand'}
		</button>
	);
}

/** Clamped preview (2–3 lines) or full body; toggle always under the body. */
function CollapsibleBody({
	long,
	children
}: {
	long: boolean;
	children: ReactNode;
}) {
	const [expanded, setExpanded] = useState(false);
	if (!long) return <>{children}</>;
	return (
		<div className="flex flex-col">
			<div
				className={cn(
					'whitespace-pre-wrap wrap-break-word',
					expanded ? 'max-h-72 overflow-auto' : PREVIEW_LINES
				)}
			>
				{children}
			</div>
			<BodyToggle expanded={expanded} onToggle={() => setExpanded(v => !v)} />
		</div>
	);
}

/**
 * Skill / slash user row: blue pill + user args only.
 * New path: `/$name [args]`. Legacy restore: `[Skill: name]…---…args` (body hidden).
 */
export function SlashChip({
	text,
	canCancel,
	regen
}: {
	text: string;
	canCancel: boolean;
	regen?: RegenSlot;
}) {
	const skill = parseUserSkillDisplay(text);
	if (!skill) {
		return <UserBubble text={text} canCancel={canCancel} regen={regen} />;
	}
	const args = skill.args;
	const long = Boolean(args) && isLongBody(args);

	return (
		<UserMessageShell canCancel={canCancel} regen={regen}>
			<CollapsibleBody long={long}>
				<SkillChip name={skill.name} />
				{args ? (
					<>
						{' '}
						<MentionText text={args} />
					</>
				) : null}
			</CollapsibleBody>
		</UserMessageShell>
	);
}

/** Plain user bubble; long bodies clamp to 2–3 lines with bottom Expand/Collapse. */
export function UserBubble({
	text,
	canCancel,
	regen,
	scheduled,
	wake,
	dockedBelow,
	images
}: {
	text: string;
	canCancel: boolean;
	regen?: RegenSlot;
	scheduled?: boolean;
	wake?: boolean;
	dockedBelow?: boolean;
	images?: Array<{mediaType: string; name?: string; dataUrl: string}>;
}) {
	return (
		<UserMessageShell
			canCancel={canCancel}
			regen={regen}
			dockedBelow={dockedBelow}
			className={scheduled || wake ? 'border-l-2 border-primary/35 pl-3' : undefined}
		>
			{scheduled || wake ? (
				<span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
					{scheduled ? 'Scheduled' : 'Background task'}
				</span>
			) : null}
			{images && images.length > 0 ? (
				<div className="mb-2 flex flex-wrap gap-2">
					{images.map((img, i) =>
						img.dataUrl ? (
							<img
								key={`${img.name ?? 'img'}-${i}`}
								src={img.dataUrl}
								alt={img.name ?? 'attachment'}
								title={img.name}
								className="max-h-40 max-w-[12rem] rounded-md object-cover border border-border/50 cursor-zoom-in"
								onClick={() => window.open(img.dataUrl, '_blank', 'noopener,noreferrer')}
							/>
						) : (
							<span
								key={`${img.name ?? 'img'}-${i}`}
								className="rounded-md border border-border/50 px-2 py-1 text-xs text-muted-foreground"
							>
								{img.name || 'image'}
							</span>
						)
					)}
				</div>
			) : null}
			{text.trim() ? (
				<CollapsibleBody long={isLongBody(text)}>
					<MentionText text={text} />
				</CollapsibleBody>
			) : null}
		</UserMessageShell>
	);
}

/** Hover stop only on the active user prompt and running tools/commands. */
export function MessageStopHost({
	canCancel,
	children,
	className
}: {
	canCancel: boolean;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn('group/msg relative', className)}>
			{children}
			{canCancel ? (
				<Button
						type="button"
					variant="default"
					size="icon-sm"
					className={cn(
						'absolute top-1/2 right-2 z-10 size-8 -translate-y-1/2 cursor-pointer rounded-full',
						'bg-foreground text-background shadow-sm hover:bg-foreground/90',
						'opacity-0 transition-opacity group-hover/msg:opacity-100 focus-visible:opacity-100'
					)}
					aria-label="Stop"
					title="Stop (Esc)"
					onClick={e => {
						e.preventDefault();
						e.stopPropagation();
						stopCurrentRun();
					}}
				>
					<Square className="size-2.5 fill-current" />
				</Button>
			) : null}
				</div>
	);
}
