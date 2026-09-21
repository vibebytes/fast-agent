import {useTranslation} from 'react-i18next';
import {
	InputGroupAddon,
	InputGroupButton
} from '@fast-ide/ui/components/input-group';
import {Popover, PopoverContent, PopoverTrigger} from '@fast-ide/ui/components/popover';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	ArrowUp,
	Brain,
	BrainCircuit,
	Check,
	ChevronDown,
	Plus,
	Square,
	Zap
} from 'lucide-react';
import {ModelMenu} from '../dsh/composer/ModelMenu';
import {enginePickerKinds, type EngineKindName} from '../enginePicker';
import {formatSlashSubmit, type SlashItem} from '../slashCatalog';
import {openModelPicker} from './modelSettings';
import {ModelCatalogContent, ThinkingContent} from './ModelStrip';
import type {MentionRichInputHandle} from '../MentionRichInput';
import type {ModelCatalogEntry} from '../env';
import type {RefObject} from 'react';

const RUN_MODES = ['agent', 'plan', 'ask', 'yolo'] as const;
type RunModeName = (typeof RUN_MODES)[number];

export function ActionStrip(p: {
	composerDisabled: boolean;
	canAttachImages: boolean;
	setAttachNotice: (n: string | null) => void;
	fileInputRef: RefObject<HTMLInputElement | null>;
	enginePopOpen: boolean;
	setEnginePopOpen: (o: boolean) => void;
	engineKind: EngineKindName;
	availableEngineIds: readonly string[];
	pickEngine: (k: EngineKindName) => void;
	modePopOpen: boolean;
	setModePopOpen: (o: boolean) => void;
	runMode: RunModeName;
	pickMode: (m: RunModeName) => void;
	sessionId?: string;
	modelPopOpen: boolean;
	setModelPopOpen: (o: boolean) => void;
	modelButtonFull: string;
	modelButtonLabel: string;
	activeBrand?: {dotBg: string};
	composerLocked: boolean;
	canChat: boolean;
	setModelSearch: (q: string) => void;
	modelCatalog: ModelCatalogEntry[];
	modelSearch: string;
	effectiveModel: string;
	pickModel: (id: string) => void;
	thinkingPopOpen: boolean;
	setThinkingPopOpen: (o: boolean) => void;
	supportsThinking: boolean;
	supportedEfforts: string[];
	thinking: boolean;
	thinkingButtonLabel: string;
	effort?: string;
	toggleThinking: (n: boolean) => void;
	pickEffort: (n: string) => void;
	stopKind?: 'run' | 'goal';
	canSteer: boolean;
	canSubmitNow: boolean;
	canSend: boolean;
	selectedSlash: SlashItem | null;
	richRef: RefObject<MentionRichInputHandle | null>;
	draft: string;
	store: {setDraft: (t: string) => void};
}) {
	const {t} = useTranslation();
	const {
		composerDisabled, canAttachImages, setAttachNotice, fileInputRef,
		enginePopOpen, setEnginePopOpen, engineKind, availableEngineIds, pickEngine,
		modePopOpen, setModePopOpen, runMode, pickMode, sessionId,
		modelPopOpen, setModelPopOpen, modelButtonFull, modelButtonLabel, activeBrand,
		composerLocked, canChat, setModelSearch, modelCatalog, modelSearch, effectiveModel, pickModel,
		thinkingPopOpen, setThinkingPopOpen, supportsThinking, supportedEfforts, thinking,
		thinkingButtonLabel, effort, toggleThinking, pickEffort,
		stopKind, canSteer, canSubmitNow, canSend, selectedSlash, richRef, draft, store
	} = p;
	return (
					<InputGroupAddon align="block-end" className="justify-between gap-2 px-3.5 pb-3 pt-1">
						<div className="flex items-center gap-1.5 min-w-0">
							<InputGroupButton
								type="button"
								size="icon-sm"
								variant="ghost"
								className="size-7 shrink-0 rounded-full text-muted-foreground/70 hover:bg-muted/70 hover:text-foreground transition-colors disabled:opacity-40"
								disabled={composerDisabled || !canAttachImages}
								aria-label={t('shell.composer.addAttachment')}
								title={
									canAttachImages
										? t('shell.composer.addAttachment')
										: t('shell.composer.imageNotSupported')
								}
								onClick={() => {
									if (!canAttachImages) {
										setAttachNotice(t('shell.composer.imageNotSupported'));
										return;
									}
									fileInputRef.current?.click();
								}}
							>
								<Plus className="size-4" />
							</InputGroupButton>
							<Popover open={enginePopOpen} onOpenChange={setEnginePopOpen}>
								<PopoverTrigger asChild>
									<InputGroupButton
										type="button"
										size="sm"
										variant="ghost"
										className="h-7 shrink-0 gap-1 rounded-full px-2.5 text-xs font-medium capitalize text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
										disabled={composerDisabled}
										aria-label={t('shell.composer.engineKind')}
									>
										{engineKind === 'dsh' ? t('shell.composer.engineDsh') : t('shell.composer.engineFast')}
										<ChevronDown className="size-3 opacity-60" />
									</InputGroupButton>
								</PopoverTrigger>
								<PopoverContent className="w-40 p-1" align="start">
									{enginePickerKinds(availableEngineIds).map(k => (
										<button
											key={k}
											type="button"
											className={cn(
												'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm capitalize hover:bg-accent',
												k === engineKind && 'bg-accent'
											)}
											onClick={() => void pickEngine(k)}
										>
											{k === 'dsh' ? t('shell.composer.engineDsh') : t('shell.composer.engineFast')}
											{k === engineKind && <Check className="size-3.5" />}
										</button>
									))}
								</PopoverContent>
							</Popover>
							{engineKind !== 'dsh' && (
							<Popover open={modePopOpen} onOpenChange={setModePopOpen}>
								<PopoverTrigger asChild>
									<InputGroupButton
										type="button"
										size="sm"
										variant="ghost"
										className="h-7 shrink-0 gap-1 rounded-full px-2.5 text-xs font-medium capitalize text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
										disabled={composerDisabled}
										aria-label={t('shell.composer.runMode')}
									>
										{runMode}
										<ChevronDown className="size-3 opacity-60" />
									</InputGroupButton>
								</PopoverTrigger>
								<PopoverContent className="w-40 p-1" align="start">
									{RUN_MODES.map(m => (
										<button
											key={m}
											type="button"
											className={cn(
												'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm capitalize hover:bg-accent',
												m === runMode && 'bg-accent'
											)}
											onClick={() => void pickMode(m)}
										>
											{m}
											{m === runMode && <Check className="size-3.5" />}
										</button>
									))}
								</PopoverContent>
							</Popover>
							)}
							{engineKind === 'dsh' ? (
								<ModelMenu sessionId={sessionId} disabled={composerDisabled} />
							) : (
							<Popover open={modelPopOpen} onOpenChange={setModelPopOpen}>
								<PopoverTrigger asChild>
									<InputGroupButton
										type="button"
										size="sm"
										variant="ghost"
										title={modelButtonFull}
										aria-label={modelButtonFull}
										className={cn(
											'h-7 max-w-[14rem] shrink-0 gap-1.5 rounded-full px-2.5 text-xs font-medium transition-all duration-150 border border-transparent',
											modelPopOpen
												? 'bg-muted text-foreground border-border/70 shadow-xs'
												: 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
										)}
										disabled={composerDisabled}
										onClick={() => {
											if (!modelPopOpen) void openModelPicker({composerLocked, canChat, setModelSearch, setModelPopOpen});
										}}
									>
										<span
											className={cn(
												'size-2 rounded-full shrink-0',
												activeBrand?.dotBg ?? 'bg-muted-foreground'
											)}
										/>
										<span className="truncate">{modelButtonLabel}</span>
										<ChevronDown
											className={cn(
												'size-3 shrink-0 opacity-60 transition-transform duration-200',
												modelPopOpen && 'rotate-180'
											)}
										/>
									</InputGroupButton>
								</PopoverTrigger>
								<ModelCatalogContent
									modelCatalog={modelCatalog}
									modelSearch={modelSearch}
									setModelSearch={setModelSearch}
									setModelPopOpen={setModelPopOpen}
									effectiveModel={effectiveModel}
									pickModel={pickModel}
								/>
							</Popover>
							)}

							{/* 独立 思考/力度胶囊 (Thinking & Effort Pill) */}
							{engineKind !== 'dsh' && (supportsThinking || supportedEfforts.length > 0) && (
								<Popover open={thinkingPopOpen} onOpenChange={setThinkingPopOpen}>
									<PopoverTrigger asChild>
										<InputGroupButton
											type="button"
											size="sm"
											variant="ghost"
											title={t('shell.composer.thinkingSettings', {defaultValue: '思考设置'})}
											aria-label={t('shell.composer.thinkingSettings', {defaultValue: '思考设置'})}
											className={cn(
												'h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-xs font-medium transition-all duration-150 border',
												thinkingPopOpen
													? 'bg-muted text-foreground border-border/70 shadow-xs'
													: thinking
														? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25 hover:bg-blue-500/15'
														: 'text-muted-foreground hover:bg-muted/70 hover:text-foreground border-transparent'
											)}
											disabled={composerDisabled}
										>
											{thinking ? (
												<BrainCircuit className="size-3.5 text-blue-600 dark:text-blue-400 shrink-0 stroke-[2.2]" />
											) : (
												<Brain className="size-3.5 text-muted-foreground shrink-0 opacity-70" />
											)}
											<span>{thinkingButtonLabel}</span>
											<ChevronDown
												className={cn(
													'size-3 shrink-0 opacity-60 transition-transform duration-200',
													thinkingPopOpen && 'rotate-180'
												)}
											/>
										</InputGroupButton>
									</PopoverTrigger>
									<ThinkingContent
										supportsThinking={supportsThinking}
										supportedEfforts={supportedEfforts}
										thinking={thinking}
										effort={effort}
										toggleThinking={toggleThinking}
										pickEffort={pickEffort}
									/>
								</Popover>
							)}
						</div>
						{stopKind ? (
							<InputGroupButton
								type="button"
								size="icon-sm"
								variant="default"
								className="relative size-7 cursor-pointer rounded-full bg-foreground text-background hover:bg-foreground/90 active:scale-95 transition-all shadow-sm"
								aria-label={
									stopKind === 'goal' ? t('shell.background.stopGoal') : t('shell.common.stop')
								}
								title={
									stopKind === 'goal'
										? t('shell.background.stopGoal')
										: `${t('shell.common.stop')} (Esc)`
								}
								onClick={() =>
									stopKind === 'goal'
										? void window.fastIde.cancelGoal()
										: void window.fastIde.cancelRun()
								}
							>
								<Square className="size-2.5 fill-current" />
								<span className="pointer-events-none absolute inset-0.5 rounded-full border-2 border-background/20 border-t-background animate-spin" />
							</InputGroupButton>
						) : (
							<>
								{canSteer && !canSubmitNow ? (
									<InputGroupButton
										type="button"
										size="icon-sm"
										variant="ghost"
										className="size-7 cursor-pointer rounded-full disabled:opacity-30 disabled:cursor-not-allowed"
										disabled={!canSend}
										aria-label="Steer"
										onClick={() => {
											const snap = selectedSlash ? null : richRef.current?.snapshot();
											const text = selectedSlash
												? formatSlashSubmit(selectedSlash.name, draft)
												: (snap?.text ?? draft).trim();
											if (!text) return;
											void window.fastIde.dshSteer(text);
											richRef.current?.clear();
											store.setDraft('');
										}}
									>
										<Zap className="size-3.5" />
									</InputGroupButton>
								) : null}
								<InputGroupButton
									type="submit"
									size="icon-sm"
									variant="default"
									className="size-7 cursor-pointer rounded-full bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-all shadow-sm disabled:opacity-30 disabled:scale-100 disabled:cursor-not-allowed"
									disabled={!canSend}
									aria-label={t('shell.common.send')}
								>
									<ArrowUp className="size-3.5 stroke-[2.2]" />
								</InputGroupButton>
							</>
						)}
					</InputGroupAddon>
	);
}
