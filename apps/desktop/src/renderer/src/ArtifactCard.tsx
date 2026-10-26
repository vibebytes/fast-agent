import {useContext} from 'react';
import {ArrowUpRight, Boxes, FileText, Globe, Package, Table} from 'lucide-react';
import {cn} from '@fast-ide/ui/lib/utils';
import type {ArtifactKind, ArtifactSpec} from '@fast-ide/session-view';

import {shellT as t} from './i18n/t';
import {OpenFileContext} from './MarkdownMessage';
import {requestOpenMcpApp} from './mcpApp/openRequest';
import {requestOpenSurface} from './surfaces/openRequest';

const ICON: Record<ArtifactKind, typeof Boxes> = {
	scene: Boxes,
	document: FileText,
	site: Globe,
	report: FileText,
	dataset: Table,
	other: Package
};

const ACCENT: Record<ArtifactKind, string> = {
	scene: 'from-[#7C5CFF]/25 to-[#4CC9F0]/20 text-[#B4A6FF]',
	document: 'from-[#007AFF]/22 to-[#5AC8FA]/16 text-[#5AA9FF]',
	site: 'from-[#34C759]/22 to-[#30D158]/14 text-[#5BD97C]',
	report: 'from-[#FF9F0A]/22 to-[#FFD60A]/14 text-[#FFB340]',
	dataset: 'from-[#64D2FF]/20 to-[#0A84FF]/14 text-[#6FD3FF]',
	other: 'from-foreground/12 to-foreground/5 text-foreground/70'
};

/** One card per declared artifact, for every producer: the host owns the chrome, the tool owns
 * the data. The click resolves to an existing tab — a `ui://` app, an extension web surface, or a
 * workspace file — so the card introduces no transport of its own. */
export function ArtifactCard({spec, className}: {spec: ArtifactSpec; className?: string}) {
	const openFile = useContext(OpenFileContext);
	const Icon = ICON[spec.kind] ?? Package;

	const canOpen =
		spec.open?.kind === 'app' ||
		spec.open?.kind === 'surface' ||
		(spec.open?.kind === 'file' && Boolean(openFile));

	function open() {
		const target = spec.open;
		if (!target) return;
		if (target.kind === 'app') {
			requestOpenMcpApp({
				server: target.server,
				resourceUri: target.resourceUri,
				title: target.title ?? spec.title
			});
			return;
		}
		if (target.kind === 'surface') {
			requestOpenSurface({
				extId: target.extId,
				surfaceId: target.surfaceId,
				url: target.url,
				instanceKey: target.instanceKey,
				roomId: target.roomId,
				title: target.title ?? spec.title
			});
			return;
		}
		openFile?.(target.path);
	}

	return (
		<div
			data-artifact-kind={spec.kind}
			role={canOpen ? 'button' : undefined}
			tabIndex={canOpen ? 0 : undefined}
			onClick={canOpen ? open : undefined}
			onKeyDown={
				canOpen
					? e => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								open();
							}
						}
					: undefined
			}
			className={cn(
				'flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5',
				'transition-colors',
				canOpen && 'cursor-pointer hover:border-border hover:bg-card/80',
				className
			)}
		>
			<span
				className={cn(
					'flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br',
					ACCENT[spec.kind] ?? ACCENT.other
				)}
				aria-hidden
			>
				<Icon className="size-4.5" />
			</span>
			<div className="min-w-0 flex-1">
				<div className="truncate text-[13px] font-medium leading-5 text-foreground">{spec.title}</div>
				{spec.subtitle ? (
					<div className="truncate text-[11px] leading-4 text-muted-foreground">{spec.subtitle}</div>
				) : null}
				{spec.meta?.length ? (
					<div className="mt-1 flex flex-wrap items-center gap-1">
						{spec.meta.map(chip => (
							<span
								key={chip}
								className="rounded bg-muted/60 px-1.5 py-0.5 text-[10.5px] leading-4 text-muted-foreground"
							>
								{chip}
							</span>
						))}
					</div>
				) : null}
			</div>
			{canOpen ? (
				<button
					type="button"
					onClick={e => {
						e.stopPropagation();
						open();
					}}
					className={cn(
						'inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1',
						'text-[11.5px] font-medium text-foreground/85 transition-colors',
						'hover:bg-muted/70 hover:text-foreground'
					)}
				>
					{t('shell.toolCard.artifactOpen')}
					<ArrowUpRight className="size-3.5" aria-hidden />
				</button>
			) : null}
		</div>
	);
}
