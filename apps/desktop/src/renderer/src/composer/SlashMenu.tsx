import {type Ref} from 'react';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandList
} from '@fast-ide/ui/components/command';
import {cn} from '@fast-ide/ui/lib/utils';
import {Boxes} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {type SlashItem, type SlashMenuGroups} from '../slashCatalog';

const SYSTEM_BLUE = 'text-[#007AFF] dark:text-[#0A84FF]';
const KNOWN_SLASH_BADGES = new Set(['personal', 'builtin', 'project']);

export function SlashMenu({
	slashCmdValue,
	flatSlashMenu,
	slashMenuGroups,
	slashHydrated,
	skillsTimedOut,
	slashSkillsEmpty,
	slashRowsLength,
	listRef,
	onHighlight,
	onPick
}: {
	slashCmdValue: string;
	flatSlashMenu: SlashItem[];
	slashMenuGroups: SlashMenuGroups;
	slashHydrated: boolean;
	skillsTimedOut: boolean;
	slashSkillsEmpty: boolean;
	slashRowsLength: number;
	listRef: Ref<HTMLDivElement>;
	onHighlight: (idx: number) => void;
	onPick: (item: SlashItem) => void;
}) {
	const {t} = useTranslation();

	function renderSlashMenuItem(item: SlashItem, idx: number) {
		return (
			<CommandItem
				key={`${item.kind}-${item.name}`}
				value={`${item.kind}:${item.name}`}
				data-menu-idx={idx}
				onMouseEnter={() => onHighlight(idx)}
				onSelect={() => onPick(item)}
			>
				{item.kind === 'skill' && (
					<Boxes className={cn('size-3.5 shrink-0', SYSTEM_BLUE)} />
				)}
				<span className="min-w-28 font-medium">{item.label}</span>
				<span className="flex-1 truncate text-muted-foreground">{item.description}</span>
				{item.badge && (
					<span className="text-[11px] text-muted-foreground">
						{KNOWN_SLASH_BADGES.has(item.badge)
							? t(`slash.badge.${item.badge}`)
							: item.badge}
					</span>
				)}
			</CommandItem>
		);
	}

	return (
		<div className="absolute inset-x-0 bottom-full z-30 mb-1 overflow-hidden rounded-2xl border border-border/70 bg-popover shadow-lg">
			<Command
				shouldFilter={false}
				value={slashCmdValue}
				onValueChange={v => {
					const idx = flatSlashMenu.findIndex(
						i => `${i.kind}:${i.name}` === v
					);
					if (idx >= 0) onHighlight(idx);
				}}
				className="max-h-80"
			>
				<CommandList ref={listRef}>
					{/* Only when the whole menu is empty — avoid stacking with the skill-loading hint. */}
					{flatSlashMenu.length === 0 &&
						!(!slashHydrated && !skillsTimedOut && slashSkillsEmpty) && (
							<CommandEmpty>
								{slashRowsLength === 0 ? t('shell.composer.noSkills') : t('shell.composer.noMatch')}
							</CommandEmpty>
						)}
					{slashMenuGroups.commands.length > 0 && (
						<CommandGroup heading={t('shell.composer.groupCommands')}>
							{slashMenuGroups.commands.map(item =>
								renderSlashMenuItem(item, flatSlashMenu.indexOf(item))
							)}
						</CommandGroup>
					)}
					{slashMenuGroups.platform.length > 0 && (
						<CommandGroup heading={t('shell.composer.groupPlatform')}>
							{slashMenuGroups.platform.map(item =>
								renderSlashMenuItem(item, flatSlashMenu.indexOf(item))
							)}
						</CommandGroup>
					)}
					{slashMenuGroups.coding.length > 0 && (
						<CommandGroup heading={t('shell.composer.groupCoding')}>
							{slashMenuGroups.coding.map(item =>
								renderSlashMenuItem(item, flatSlashMenu.indexOf(item))
							)}
						</CommandGroup>
					)}
					{slashMenuGroups.external.length > 0 && (
						<CommandGroup heading={t('shell.composer.groupExternal')}>
							{slashMenuGroups.external.map(item =>
								renderSlashMenuItem(item, flatSlashMenu.indexOf(item))
							)}
						</CommandGroup>
					)}
					{/* Loading / empty catalog under commands — never "无匹配" when commands already hit. */}
					{slashSkillsEmpty &&
						!slashHydrated &&
						!skillsTimedOut && (
							<div className="px-2 py-1.5 text-xs text-muted-foreground">{t('shell.composer.loadingSkills')}</div>
						)}
				</CommandList>
			</Command>
		</div>
	);
}
