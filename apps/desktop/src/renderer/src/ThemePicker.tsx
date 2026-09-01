import {useMemo, useState} from 'react';
import {Button} from '@fast-ide/ui/components/button';
import {Input} from '@fast-ide/ui/components/input';
import {Popover, PopoverContent, PopoverTrigger} from '@fast-ide/ui/components/popover';
import {ScrollArea} from '@fast-ide/ui/components/scroll-area';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	DEFAULT_PALETTE_ID,
	getPaletteTheme,
	PALETTE_CATEGORIES,
	PALETTE_THEMES,
	type PaletteCategory,
	type PaletteTheme
} from '@fast-ide/ui/themes/catalog';
import {Check, ChevronDown, RotateCcw, Search} from 'lucide-react';

function Swatches({colors, size = 'sm'}: {colors: string[]; size?: 'sm' | 'md'}) {
	const dim = size === 'md' ? 'size-3' : 'size-2.5';
	return (
		<span className="flex items-center -space-x-0.5" aria-hidden>
			{colors.slice(0, 5).map((color, i) => (
				<span
					key={`${color}-${i}`}
					className={cn(dim, 'rounded-full border border-black/10 dark:border-white/15')}
					style={{background: color, zIndex: 5 - i}}
				/>
			))}
		</span>
	);
}

export function ThemePicker({
	paletteId,
	onPaletteChange,
	className,
	variant = 'floating',
	compact = false
}: {
	paletteId: string;
	onPaletteChange: (id: string) => void;
	className?: string;
	/** `sidebar` — full-width trigger for the left rail footer. */
	variant?: 'floating' | 'sidebar';
	compact?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState('');
	const [category, setCategory] = useState<PaletteCategory | 'all'>('all');
	const active = getPaletteTheme(paletteId);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return PALETTE_THEMES.filter(theme => {
			if (category !== 'all' && theme.category !== category) return false;
			if (!q) return true;
			return (
				theme.title.toLowerCase().includes(q) ||
				theme.id.toLowerCase().includes(q) ||
				theme.description.toLowerCase().includes(q)
			);
		});
	}, [search, category]);

	function pick(theme: PaletteTheme) {
		onPaletteChange(theme.id);
	}

	function reset() {
		setSearch('');
		setCategory('all');
		onPaletteChange(DEFAULT_PALETTE_ID);
	}

	const sidebar = variant === 'sidebar';

	return (
		<div className={cn(sidebar ? 'w-full' : 'pointer-events-auto', className)}>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="outline"
						size={compact ? 'xs' : 'sm'}
						className={cn(
							'gap-2 px-3',
							sidebar
								? cn(
										'w-full justify-start rounded-md shadow-none',
										compact ? 'h-6' : 'h-8'
									)
								: 'h-9 rounded-full border bg-background/95 shadow-md backdrop-blur supports-backdrop-filter:bg-background/80'
						)}
						aria-label={`Theme: ${active.title}`}
					>
						<Swatches colors={active.swatches} size="md" />
						<span
							className={cn(
								'truncate text-xs font-medium',
								sidebar ? 'min-w-0 flex-1 text-left' : 'max-w-28'
							)}
						>
							{active.title}
						</span>
						<ChevronDown className="size-3.5 shrink-0 opacity-60" />
					</Button>
				</PopoverTrigger>
				<PopoverContent
					align={sidebar ? 'start' : 'end'}
					side="top"
					sideOffset={sidebar ? 8 : 10}
					className="w-[min(22rem,calc(100vw-1.5rem))] p-0"
				>
					<div className="border-b p-3 pb-2">
						<div className="relative">
							<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								value={search}
								onChange={e => setSearch(e.target.value)}
								placeholder="Search themes…"
								className="h-8 pl-8"
							/>
						</div>
						<div className="mt-2 flex gap-1 overflow-x-auto pb-1">
							{PALETTE_CATEGORIES.map(cat => (
								<button
									key={cat.id}
									type="button"
									onClick={() => setCategory(cat.id)}
									className={cn(
										'shrink-0 rounded-md px-2 py-1 text-[11px] font-medium tracking-wide uppercase',
										category === cat.id
											? 'bg-primary text-primary-foreground'
											: 'text-muted-foreground hover:bg-muted hover:text-foreground'
									)}
								>
									{cat.label}
								</button>
							))}
						</div>
						<div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
							<span>
								{filtered.length} theme{filtered.length === 1 ? '' : 's'}
							</span>
							<button
								type="button"
								className="inline-flex items-center gap-1 hover:text-foreground"
								onClick={reset}
							>
								<RotateCcw className="size-3" />
								Reset
							</button>
						</div>
					</div>
					<ScrollArea className="h-80">
						<ul className="p-1.5">
							{filtered.map(theme => {
								const isActive = theme.id === active.id;
								return (
									<li key={theme.id}>
										<button
											type="button"
											onClick={() => pick(theme)}
											className={cn(
												'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors',
												isActive
													? 'bg-primary text-primary-foreground'
													: 'hover:bg-muted'
											)}
											title={theme.description}
										>
											<Swatches colors={theme.swatches} />
											<span className="min-w-0 flex-1 truncate font-medium">{theme.title}</span>
											{isActive ? (
												<span className="flex shrink-0 items-center gap-1 text-[11px] opacity-90">
													Active
													<Check className="size-3.5" />
												</span>
											) : null}
										</button>
									</li>
								);
							})}
							{filtered.length === 0 ? (
								<li className="px-3 py-8 text-center text-sm text-muted-foreground">
									No matching themes
								</li>
							) : null}
						</ul>
					</ScrollArea>
				</PopoverContent>
			</Popover>
		</div>
	);
}
