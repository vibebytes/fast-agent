import type {ComponentProps, ComponentType, ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {AlertCircle, AlertTriangle, CheckCircle2, LoaderCircle, Wrench} from 'lucide-react';
import {Badge} from '@fast-ide/ui/components/badge';
import {Button} from '@fast-ide/ui/components/button';
import {Card, CardAction, CardContent, CardHeader, CardTitle} from '@fast-ide/ui/components/card';
import {Switch} from '@fast-ide/ui/components/switch';
import {cn} from '@fast-ide/ui/lib/utils';
import type {MockStatus, Source} from './mock/settingsMockTypes';

export type SettingsIcon = ComponentType<{className?: string}>;

/** Compact settings control (select/input) — matches SettingsButton xs/sm height. */
export const settingsControlClass =
	'h-7 min-w-28 rounded-lg border border-input/80 bg-background/80 px-2.5 text-[12px] font-normal leading-none shadow-xs transition-colors hover:border-input focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function SettingsButton({
	size = 'xs',
	className,
	...props
}: ComponentProps<typeof Button>) {
	return (
		<Button
			size={size}
			className={cn(
				'rounded-lg font-medium transition-all duration-150',
				size === 'xs' && 'h-7 px-2.5 text-[12px]',
				className
			)}
			{...props}
		/>
	);
}

export function SettingsPageHeader({
	icon: Icon,
	title,
	description
}: {
	icon: SettingsIcon;
	title: string;
	description: string;
}) {
	return (
		<div className="mb-4 flex items-center justify-between gap-3 border-b border-border/40 pb-3">
			<div className="flex items-center gap-2.5 min-w-0">
				<div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<Icon className="size-4" />
				</div>
				<h1 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h1>
				{description ? (
					<p className="min-w-0 truncate text-[12px] text-muted-foreground/90">
						<span className="mx-1.5 text-border">·</span>
						{description}
					</p>
				) : null}
			</div>
		</div>
	);
}

export function SettingsSection({
	title,
	description,
	action,
	tone = 'default',
	className,
	children
}: {
	title?: string;
	description?: string;
	action?: ReactNode;
	tone?: 'default' | 'group' | 'accent' | 'danger';
	className?: string;
	children?: ReactNode;
}) {
	const header = title || action;
	return (
		<Card
			className={cn(
				'gap-0 rounded-xl border border-border/70 bg-card/40 py-0 shadow-xs backdrop-blur-xs transition-all duration-150',
				tone === 'accent' && 'border-primary/30 bg-primary/5',
				tone === 'danger' && 'border-destructive/30 bg-destructive/5',
				className
			)}
		>
			{header ? (
				<CardHeader
					className={cn(
						'gap-0.5 px-4 py-3',
						children ? 'border-b border-border/50' : '',
						!description && 'grid-rows-1'
					)}
				>
					{title ? (
						<CardTitle
							className={cn(
								'leading-tight',
								tone === 'group'
									? 'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'
									: 'text-[13px] font-semibold tracking-tight text-foreground'
							)}
						>
							{title}
						</CardTitle>
					) : null}
					{description ? (
						<p className="text-[12px] leading-relaxed text-muted-foreground/80">{description}</p>
					) : null}
					{action ? <CardAction className="self-center">{action}</CardAction> : null}
				</CardHeader>
			) : null}
			{children ? <CardContent className="divide-y divide-border/40 px-0 py-0">{children}</CardContent> : null}
		</Card>
	);
}

export function SettingsRow({
	icon: Icon,
	title,
	description,
	badge,
	children,
	className,
	onClick
}: {
	icon?: SettingsIcon;
	title: ReactNode;
	description?: ReactNode;
	badge?: ReactNode;
	children?: ReactNode;
	className?: string;
	onClick?: () => void;
}) {
	return (
		<div
			onClick={onClick}
			className={cn(
				'flex items-center justify-between gap-4 px-4 py-3 transition-colors duration-150 hover:bg-muted/20',
				onClick && 'cursor-pointer',
				className
			)}
		>
			<div className="flex items-start gap-3 min-w-0">
				{Icon ? (
					<div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/60 border border-border/40 text-muted-foreground">
						<Icon className="size-3.5" />
					</div>
				) : null}
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						{typeof title === 'string' ? (
							<span className="text-[13px] font-medium leading-tight text-foreground">{title}</span>
						) : (
							title
						)}
						{badge}
					</div>
					{description ? (
						<div className="mt-0.5 text-[12px] leading-snug text-muted-foreground/80">
							{description}
						</div>
					) : null}
				</div>
			</div>
			{children ? <div className="shrink-0 flex items-center gap-2">{children}</div> : null}
		</div>
	);
}

export function SettingsSwitchRow({
	icon: Icon,
	title,
	description,
	badge,
	checked,
	onCheckedChange,
	disabled = false,
	className
}: {
	icon?: SettingsIcon;
	title: string;
	description?: string;
	badge?: ReactNode;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<div
			className={cn(
				'flex items-center justify-between gap-4 px-4 py-3 transition-colors duration-150 hover:bg-muted/20',
				disabled && 'opacity-60 cursor-not-allowed',
				className
			)}
		>
			<div className="flex items-start gap-3 min-w-0">
				{Icon ? (
					<div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/60 border border-border/40 text-muted-foreground">
						<Icon className="size-3.5" />
					</div>
				) : null}
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-[13px] font-medium leading-tight text-foreground">{title}</span>
						{badge}
					</div>
					{description ? (
						<p className="mt-0.5 text-[12px] leading-snug text-muted-foreground/80">{description}</p>
					) : null}
				</div>
			</div>
			<div className="shrink-0 flex items-center">
				<Switch
					checked={checked}
					onCheckedChange={onCheckedChange}
					disabled={disabled}
					aria-label={title}
				/>
			</div>
		</div>
	);
}

export function SettingsSourceBadge({source}: {source: Source}) {
	const {t} = useTranslation();
	const key =
		source === 'Project override'
			? 'settings.common.projectOverride'
			: source === 'Task temporary'
				? 'settings.common.taskTemporary'
				: 'settings.common.global';
	return (
		<Badge
			variant={source === 'Project override' ? 'secondary' : 'outline'}
			className="rounded-md px-1.5 py-0 text-[10px] font-medium uppercase tracking-wider"
		>
			{t(key, {defaultValue: source})}
		</Badge>
	);
}

export function SettingsStatusBadge({status}: {status: string}) {
	const {t} = useTranslation();
	const key = `settings.common.${status.toLowerCase().replaceAll(' ', '')}`;
	const lower = status.toLowerCase();
	const isNegative = /error|failed|attention|needs/i.test(lower);
	const isWarning = /warn|notice/i.test(lower);
	const isSuccess = /ready|connected|ok|healthy/i.test(lower);

	return (
		<PulseStatusBadge
			status={isNegative ? 'error' : isWarning ? 'warning' : isSuccess ? 'healthy' : 'neutral'}
			label={t(key, {defaultValue: status})}
		/>
	);
}

export function PulseStatusBadge({
	status,
	label,
	latency,
	className
}: {
	status: 'healthy' | 'warning' | 'error' | 'neutral' | string;
	label: string;
	latency?: number | string | null;
	className?: string;
}) {
	const isHealthy = status === 'healthy' || status === 'ready' || status === 'connected' || status === 'ok';
	const isWarning = status === 'warning' || status === 'attention';
	const isError = status === 'error' || status === 'failed';

	const containerStyle = isHealthy
		? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
		: isWarning
			? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25'
			: isError
				? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25'
				: 'bg-muted/80 text-muted-foreground border-border/70';

	const dotStyle = isHealthy
		? 'bg-emerald-500'
		: isWarning
			? 'bg-amber-500'
			: isError
				? 'bg-rose-500'
				: 'bg-muted-foreground/60';

	return (
		<span
			className={cn(
				'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none tracking-tight shadow-2xs',
				containerStyle,
				className
			)}
		>
			<span
				className={cn(
					'size-1.5 rounded-full',
					dotStyle,
					(isHealthy || isWarning || isError) && 'animate-pulse'
				)}
			/>
			<span>{label}</span>
			{latency !== undefined && latency !== null ? (
				<span className="opacity-70 font-mono text-[10px]">· {latency}{typeof latency === 'number' ? 'ms' : ''}</span>
			) : null}
		</span>
	);
}

export function MonoTag({
	children,
	className
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<span
			className={cn(
				'inline-flex items-center font-mono text-[11px] font-normal leading-none rounded-md border border-border/50 bg-muted/50 px-1.5 py-0.5 text-muted-foreground',
				className
			)}
		>
			{children}
		</span>
	);
}

export function SettingsState({
	status,
	title,
	description,
	onRetry
}: {
	status: MockStatus;
	title: string;
	description?: string;
	onRetry?: () => void;
}) {
	const {t} = useTranslation();
	if (status === 'loading')
		return (
			<div className="flex min-h-28 items-center justify-center text-[13px] text-muted-foreground">
				<LoaderCircle className="mr-2 size-4 animate-spin text-primary" />
				{t('settings.common.loading')}
			</div>
		);
	if (status === 'error')
		return (
			<div className="flex min-h-28 flex-col items-center justify-center gap-2 py-6 text-center">
				<div className="flex size-9 items-center justify-center rounded-full bg-destructive/10 text-destructive">
					<AlertCircle className="size-5" />
				</div>
				<p className="text-[13px] font-semibold text-foreground">{title}</p>
				{description ? (
					<p className="max-w-md text-[12px] text-muted-foreground">{description}</p>
				) : null}
				{onRetry ? (
					<SettingsButton variant="outline" onClick={onRetry} className="mt-1">
						{t('settings.common.retry')}
					</SettingsButton>
				) : null}
			</div>
		);
	if (status === 'empty')
		return (
			<div className="flex min-h-28 flex-col items-center justify-center gap-2 py-6 text-center">
				<div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
					<Wrench className="size-4" />
				</div>
				<p className="text-[13px] font-medium text-foreground">{title}</p>
				{description ? (
					<p className="max-w-md text-[12px] text-muted-foreground">{description}</p>
				) : null}
			</div>
		);
	if (status === 'disabled')
		return (
			<div className="flex min-h-28 flex-col items-center justify-center gap-2 py-6 text-center">
				<div className="flex size-9 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
					<AlertTriangle className="size-4" />
				</div>
				<p className="text-[13px] font-medium text-foreground">{title}</p>
				{description ? (
					<p className="max-w-md text-[12px] text-muted-foreground">{description}</p>
				) : null}
				{onRetry ? (
					<SettingsButton variant="outline" onClick={onRetry} className="mt-1">
						{t('settings.common.retry')}
					</SettingsButton>
				) : null}
			</div>
		);
	return (
		<div className="flex items-center gap-2 py-2 text-[12px] text-muted-foreground">
			<CheckCircle2 className="size-4 text-emerald-500" />
			{t('settings.common.ready')}
		</div>
	);
}
