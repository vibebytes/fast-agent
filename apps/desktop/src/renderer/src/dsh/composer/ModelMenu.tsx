import {useEffect, useState} from 'react';
import {Check, ChevronDown, ChevronRight, LoaderCircle} from 'lucide-react';
import {InputGroupButton} from '@fast-ide/ui/components/input-group';
import {Popover, PopoverContent, PopoverTrigger} from '@fast-ide/ui/components/popover';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	currentChoice,
	effortChoices,
	effortLabel,
	modelChrome,
	openDshModelsSettings,
	refreshDshModels,
	selectDshModel,
	useDshModels,
	type MenuPane
} from './models';

export function ModelMenu({
	sessionId,
	disabled
}: {
	sessionId?: string;
	disabled?: boolean;
}) {
	const snap = useDshModels();
	const [open, setOpen] = useState(false);
	const [pane, setPane] = useState<MenuPane>('root');

	useEffect(() => {
		void refreshDshModels(sessionId);
	}, [sessionId]);

	const chrome = modelChrome(snap);
	const choice = currentChoice(snap);
	const efforts = effortChoices(choice);
	const currentEffort = snap.current?.reasoningEffort ?? choice?.reasoning?.defaultEffort;
	const currentEffortName = effortLabel(choice, snap.current?.reasoningEffort);

	function show(next: boolean): void {
		setOpen(next);
		if (next) {
			setPane('root');
			void refreshDshModels(sessionId);
		}
	}

	async function chooseModel(provider: string, model: string): Promise<void> {
		if (snap.current?.provider === provider && snap.current.model === model) {
			show(false);
			return;
		}
		const error = await selectDshModel({provider, model}, sessionId);
		if (!error) show(false);
	}

	async function chooseEffort(effort?: string): Promise<void> {
		if (!snap.current) return;
		if (currentEffort === effort) {
			show(false);
			return;
		}
		const error = await selectDshModel(
			{
				provider: snap.current.provider,
				model: snap.current.model,
				...(effort ? {reasoningEffort: effort} : {})
			},
			sessionId
		);
		if (!error) show(false);
	}

	return (
		<Popover open={open} onOpenChange={show}>
			<PopoverTrigger asChild>
				<InputGroupButton
					type="button"
					size="sm"
					variant="ghost"
					title={chrome.label}
					aria-label={
						choice
							? currentEffortName
								? `选择模型，当前 ${chrome.modelLabel}，推理等级 ${currentEffortName}`
								: `选择模型，当前 ${chrome.modelLabel}`
							: '选择模型'
					}
					aria-haspopup="menu"
					aria-expanded={open}
					className="h-7 max-w-[16rem] shrink-0 gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground"
					disabled={disabled}
				>
					{chrome.spinning ? <LoaderCircle className="size-3 animate-spin" /> : null}
					<span className="truncate">{chrome.modelLabel}</span>
					{chrome.effortLabel ? (
						<span className="shrink-0 font-medium text-muted-foreground/70">{chrome.effortLabel}</span>
					) : null}
					<ChevronDown className={cn('size-3 shrink-0 opacity-60', open && 'rotate-180')} />
				</InputGroupButton>
			</PopoverTrigger>
			<PopoverContent
				className="w-[240px] max-w-[calc(100vw-24px)] p-1 shadow-2xl border border-border/80 rounded-xl overflow-hidden"
				align="start"
				side="top"
				sideOffset={8}
				role="menu"
				aria-label="模型与推理等级"
				onEscapeKeyDown={event => {
					if (pane !== 'root') {
						event.preventDefault();
						setPane('root');
					}
				}}
			>
				{snap.failures.length > 0 ? (
					<div className="mb-1 rounded-lg bg-muted px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
						{snap.failures.map(f => (
							<div key={f.id}>
								{f.name}: {f.message}
							</div>
						))}
					</div>
				) : null}
				{chrome.pane === 'loading' ? (
					<div className="px-2.5 py-2.5 text-[13px] text-muted-foreground">正在加载</div>
				) : chrome.pane === 'retry' ? (
					<div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-xs text-muted-foreground">
						<p>{snap.notice ?? 'DSH 未就绪'}</p>
						<button
							type="button"
							className="rounded-md bg-accent px-2 py-1 text-foreground"
							onClick={() => void refreshDshModels(sessionId)}
						>
							重试
						</button>
					</div>
				) : pane === 'root' ? (
					<>
						<button
							type="button"
							role="menuitem"
							className="flex h-10 w-full items-center gap-2 rounded-[10px] px-2.5 text-left text-[14px] leading-[22px] hover:bg-accent"
							onClick={() => setPane('model')}
						>
							<span className="min-w-0 flex-1 truncate text-foreground">模型</span>
							<span className="min-w-0 truncate text-muted-foreground">{chrome.modelLabel}</span>
							<ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
						</button>
						{choice?.reasoning ? (
							<button
								type="button"
								role="menuitem"
								className="flex h-10 w-full items-center gap-2 rounded-[10px] px-2.5 text-left text-[14px] leading-[22px] hover:bg-accent"
								onClick={() => setPane('effort')}
							>
								<span className="min-w-0 flex-1 truncate text-foreground">推理等级</span>
								<span className="min-w-0 truncate text-muted-foreground">{currentEffortName}</span>
								<ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
							</button>
						) : null}
					</>
				) : pane === 'model' ? (
					<div className="max-h-[320px] overflow-y-auto">
						{snap.groups.map(group => (
							<section key={group.id} className="mb-1 last:mb-0">
								<div className="sticky top-0 bg-popover px-2 py-1 text-[12px] font-medium text-muted-foreground">
									{group.name}
								</div>
								{group.models.map(model => {
									const selected =
										snap.current?.provider === group.id && snap.current?.model === model.id;
									return (
										<button
											key={`${group.id}:${model.id}`}
											type="button"
											role="menuitemradio"
											aria-checked={selected}
											title={model.name}
											className="flex min-h-[38px] w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-accent"
											onClick={() => void chooseModel(group.id, model.id)}
										>
											<span className="min-w-0 flex-1">
												<span className="block truncate text-[14px] font-medium leading-5">
													{model.name}
												</span>
												{model.description ? (
													<span className="block truncate text-[12px] leading-[18px] text-muted-foreground">
														{model.description}
													</span>
												) : null}
											</span>
											<span className="grid size-[18px] shrink-0 place-items-center">
												{selected ? <Check className="size-3.5" /> : null}
											</span>
										</button>
									);
								})}
							</section>
						))}
						{snap.groups.every(g => g.models.length === 0) ? (
							<div className="px-2.5 py-2.5 text-[13px] text-muted-foreground">没有可用的模型。</div>
						) : null}
					</div>
				) : efforts.length === 0 ? (
					<div className="px-2.5 py-2.5 text-[13px] text-muted-foreground">当前模型未提供推理等级。</div>
				) : (
					efforts.map(level => {
						const selected = currentEffort === level.effort;
						return (
							<button
								key={level.key}
								type="button"
								role="menuitemradio"
								aria-checked={selected}
								className="flex min-h-[38px] w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-accent"
								onClick={() => void chooseEffort(level.effort)}
							>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-[14px] font-medium leading-5">{level.label}</span>
									{level.description ? (
										<span className="block truncate text-[12px] leading-[18px] text-muted-foreground">
											{level.description}
										</span>
									) : null}
								</span>
								<span className="grid size-[18px] shrink-0 place-items-center">
									{selected ? <Check className="size-3.5" /> : null}
								</span>
							</button>
						);
					})
				)}
				{snap.error?.code === 'MISSING_CREDENTIAL' ? (
					<div className="mt-1 border-t border-border/60 px-2 py-2 text-[11px]">
						<p className="text-destructive">{snap.error.message ?? 'MISSING_CREDENTIAL'}</p>
						<button
							type="button"
							className="mt-1 text-foreground underline"
							onClick={() => {
								show(false);
								openDshModelsSettings();
							}}
						>
							去填密钥
						</button>
					</div>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
