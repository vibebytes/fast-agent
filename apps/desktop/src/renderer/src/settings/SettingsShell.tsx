import {useSyncExternalStore, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {
	// Activity,
	ArrowLeft,
	Bot,
	Boxes,
	Cpu,
	// FolderKanban,
	// Gauge,
	Globe,
	HardDrive,
	Info,
	// Layers3,
	LockKeyhole,
	Settings,
	ShieldCheck,
	SlidersHorizontal,
	UsersRound
} from 'lucide-react';
import {Button} from '@fast-ide/ui/components/button';
import {cn} from '@fast-ide/ui/lib/utils';
import {settingsMockStore} from './mock/settingsMockStore';
import type {SettingsIcon} from './SettingsPrimitives';

export type SettingsSection = 'general' | 'providers' | 'models' | 'agents' | 'plugins' | 'engines' | 'projects' | 'servers' | 'security' | 'tasks' | 'usage' | 'health' | 'tracing' | 'about';
type SectionCopy = {label: string; description: string};
export type SettingsSectionMeta = {id: SettingsSection; icon: SettingsIcon; copy: SectionCopy};
export type SettingsNavItem<Id extends string = SettingsSection> = {
	id: Id;
	icon: SettingsIcon;
	copyKey: string;
	/** Keep the page; omit from the sidebar. Flip to restore. */
	hidden?: boolean;
};
export const settingsSections: SettingsNavItem[] = [
	{id: 'general', icon: SlidersHorizontal, copyKey: 'general'},
	{id: 'providers', icon: Globe, copyKey: 'providers'},
	{id: 'models', icon: Bot, copyKey: 'models'},
	{id: 'agents', icon: UsersRound, copyKey: 'agents'},
	{id: 'plugins', icon: Boxes, copyKey: 'plugins'},
	{id: 'engines', icon: Cpu, copyKey: 'engines'},
	{id: 'servers', icon: HardDrive, copyKey: 'servers'},
	// Temporarily hidden — restore when these pages are ready for settings nav.
	// {id: 'projects', icon: FolderKanban, copyKey: 'projects'},
	{id: 'security', icon: LockKeyhole, copyKey: 'security', hidden: true},
	// {id: 'tasks', icon: Layers3, copyKey: 'tasks'},
	// {id: 'usage', icon: Gauge, copyKey: 'usage'},
	{id: 'health', icon: ShieldCheck, copyKey: 'health', hidden: true},
	// {id: 'tracing', icon: Activity, copyKey: 'tracing'},
	{id: 'about', icon: Info, copyKey: 'about'}
];

export function useSettingsMockState() { return useSyncExternalStore(settingsMockStore.subscribe, settingsMockStore.getSnapshot, settingsMockStore.getSnapshot); }

export function SettingsShell<Id extends string = SettingsSection>({
	sections,
	activeSection,
	onSectionChange,
	onBack,
	headerExtra,
	children
}: {
	sections?: Array<SettingsNavItem<Id>>;
	activeSection: Id;
	onSectionChange: (section: Id) => void;
	onBack: () => void;
	headerExtra?: ReactNode;
	children: ReactNode;
}) {
	const {t} = useTranslation();
	const nav = (sections ?? (settingsSections as Array<SettingsNavItem<Id>>)).filter(item => !item.hidden);
	const copy = (id: string): SectionCopy => ({
		label: t(`settings.navigation.${id}`, {defaultValue: id}),
		description: t(`settings.navigation.${id}Description`, {defaultValue: ''})
	});
	return (
		<div className="flex h-svh min-h-0 w-full flex-col bg-background text-foreground">
			<header className="flex h-10 shrink-0 items-stretch border-b">
				<div
					className={cn(
						'app-region-no-drag shrink-0',
						typeof window !== 'undefined' && window.fastIde.platform === 'darwin'
							? 'w-[108px]'
							: 'w-0'
					)}
					aria-hidden
				/>
				<div className="app-region-drag flex min-w-0 flex-1 items-center gap-1.5 px-3 text-[13px] font-medium">
					<Settings className="size-3.5 text-muted-foreground" />
					{t('settings.navigation.title')}
				</div>
				{headerExtra ? (
					<div className="app-region-no-drag flex items-center gap-1 px-3">{headerExtra}</div>
				) : null}
			</header>
			<div className="flex min-h-0 flex-1">
				<aside className="w-64 shrink-0 overflow-y-auto border-r p-4">
					<Button
						variant="ghost"
						size="sm"
						className="mb-3 h-8 w-full justify-start gap-2 px-2 text-[13px]"
						onClick={onBack}
					>
						<ArrowLeft className="size-3.5" />
						{t('settings.navigation.backToWorkspace')}
					</Button>
					<nav className="space-y-1">
						{nav.map(item => {
							const Icon = item.icon;
							const itemCopy = copy(item.copyKey);
							return (
								<button
									key={item.id}
									type="button"
									onClick={() => onSectionChange(item.id)}
									className={cn(
										'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
										activeSection === item.id
											? 'bg-accent text-accent-foreground'
											: 'text-muted-foreground hover:bg-muted hover:text-foreground'
									)}
								>
									<Icon className="size-4 shrink-0" />
									<span className="truncate">{itemCopy.label}</span>
								</button>
							);
						})}
					</nav>
				</aside>
				<main className="min-w-0 flex-1 overflow-y-auto">
					<div className="mx-auto w-full max-w-3xl px-5 py-4">{children}</div>
				</main>
			</div>
		</div>
	);
}

export function sectionCopy(id: SettingsSection, t: (key: string, options?: {defaultValue?: string}) => string): SectionCopy { return {label: t(`settings.navigation.${id}`, {defaultValue: id}), description: t(`settings.navigation.${id}Description`, {defaultValue: ''})}; }
