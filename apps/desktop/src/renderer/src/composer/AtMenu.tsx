import {type Ref} from 'react';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandList
} from '@fast-ide/ui/components/command';
import {cn} from '@fast-ide/ui/lib/utils';
import {Bot, Boxes} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {kindTitle, type AtItem} from '../atCatalog';

const SYSTEM_BLUE = 'text-[#007AFF] dark:text-[#0A84FF]';

export function AtMenu({
	atCmdValue,
	flatAtMenu,
	atMenuByKind,
	mentionsWarming,
	listRef,
	onHighlight,
	onPick
}: {
	atCmdValue: string;
	flatAtMenu: AtItem[];
	atMenuByKind: {kind: string; items: AtItem[]}[];
	mentionsWarming: boolean;
	listRef: Ref<HTMLDivElement>;
	onHighlight: (idx: number) => void;
	onPick: (item: AtItem) => void;
}) {
	const {t} = useTranslation();

	function renderAtMenuItem(item: AtItem, idx: number) {
		return (
			<CommandItem
				key={item.ref}
				value={item.ref}
				data-menu-idx={idx}
				onMouseEnter={() => onHighlight(idx)}
				onSelect={() => onPick(item)}
			>
				{item.kind === 'skill' ? (
					<Boxes className={cn('size-3.5 shrink-0', SYSTEM_BLUE)} />
				) : (
					<Bot className="size-3.5 shrink-0 text-muted-foreground" />
				)}
				<span className="min-w-28 font-medium">{item.label}</span>
				<span className="flex-1 truncate text-muted-foreground">{item.description}</span>
			</CommandItem>
		);
	}

	return (
		<div className="absolute inset-x-0 bottom-full z-30 mb-1 overflow-hidden rounded-2xl border border-border/70 bg-popover shadow-lg">
			<Command
				shouldFilter={false}
				value={atCmdValue}
				onValueChange={v => {
					const idx = flatAtMenu.findIndex(i => i.ref === v);
					if (idx >= 0) onHighlight(idx);
				}}
				className="max-h-80"
			>
				<CommandList ref={listRef}>
					<CommandEmpty>
						{mentionsWarming
							? t('shell.composer.loadingMentions')
							: t('shell.composer.noMentions')}
					</CommandEmpty>
					{atMenuByKind.length === 0 ? (
						<div className="px-2 py-1.5 text-xs text-muted-foreground">
							{mentionsWarming
								? t('shell.composer.loadingMentions')
								: t('shell.composer.noMentions')}
						</div>
					) : (
						atMenuByKind.map(group => (
							<CommandGroup key={group.kind} heading={kindTitle(group.kind)}>
								{group.items.map(item =>
									renderAtMenuItem(item, flatAtMenu.indexOf(item))
								)}
							</CommandGroup>
						))
					)}
				</CommandList>
			</Command>
		</div>
	);
}
