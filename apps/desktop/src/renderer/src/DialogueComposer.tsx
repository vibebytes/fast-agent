import {
	memo,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type FormEvent,
	type KeyboardEvent
} from 'react';
import {InputGroup, InputGroupTextarea} from '@fast-ide/ui/components/input-group';
import {cn} from '@fast-ide/ui/lib/utils';
import {Boxes, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {createTaskComposerDraftStore} from './composerDraft';
import {revokePending, supportsImageInput, type PendingImage} from './imageAttachments';
import {Notice as DshNotice} from './dsh/composer/Notice';
import {useDshModels} from './dsh/composer/models';
import {refreshDshSkills, useDshSkills} from './dsh/skills/skills';
import type {MentionChip, ModelCatalogEntry, SlashCatalogEntry} from './env';
import {catalogProvider} from './catalogGroup';
import {atQuery, type AtItem} from './atCatalog';
import {
	MentionRichInput,
	type MentionRichInputHandle
} from './MentionRichInput';
import {
	formatSlashSubmit,
	slashQuery,
	type SlashItem
} from './slashCatalog';
import {ensurePlanPrefix, stripAutoPlanPrefix} from './planPrefix';
import {clampEffort} from './effortClamp';
import {platformModel} from './composerPlatform';
import {helpNoticeText} from './helpNoticeText';
import {
	composerModelLabel,
	concreteModelDisplay,
	isUnresolvedModelDisplay,
	matchCatalogEntry,
	sameModelRef
} from '@fast-ide/session-view';
import {
	chromeEngineKind,
	rememberEnginePick,
	shouldResyncChrome,
	type EngineKindName
} from './enginePicker';
import {SlashMenu} from './composer/SlashMenu';
import {AtMenu} from './composer/AtMenu';
import {ImageDrawer} from './composer/ImageDrawer';
import {MODEL_EFFORT_LABEL as EFFORT_LABEL} from './composer/ModelStrip';
import {ingestFiles} from './composer/ingest';
import {persistModelSettings, useEffortClamp} from './composer/modelSettings';
import {useSlashCatalog} from './composer/useSlashCatalog';
import {useMentionSuggest} from './composer/useMentionSuggest';
import {useMenuScroll} from './composer/useMenuScroll';
import {ActionStrip} from './composer/ActionStrip';
import {handleComposerKeyDown} from './composer/keys';

const SYSTEM_BLUE_CHIP =
	'bg-[#007AFF]/10 text-[#007AFF] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]';

const RUN_MODES = ['agent', 'plan', 'ask', 'yolo'] as const;
type RunModeName = (typeof RUN_MODES)[number];

export type DialogueComposerProps = {
	/** Active Task — draft is remembered per task across tab switches. */
	taskId?: string | null;
	/** True when a BackgroundTools / Review / Queue drawer stack sits directly above. */
	hasDrawerAbove?: boolean;
	canChat: boolean;
	composerLocked: boolean;
	/** Fixed right-side primary action while work can be stopped. */
	stopKind?: 'run' | 'goal';
	canSubmitNow: boolean;
	canEnqueue: boolean;
	/** `dsh_caps.queue` — busy Enter still queues; this button is explicit steer. */
	canSteer?: boolean;
	model: string;
	modelDisplay: string;
	modelCatalog: ModelCatalogEntry[];
	/** Sticky Mode / sampling restored from Task chrome. */
	stickyRunMode?: RunModeName;
	stickyEngineKind?: EngineKindName;
	availableEngineIds?: readonly string[];
	stickyEffort?: string;
	stickyThinking?: boolean;
	slashCatalog?: SlashCatalogEntry[];
	/** True after Engine answered `/skills` (empty list still counts). */
	slashCatalogHydrated?: boolean;
	/** Fired on accept-for-send with the submitted text (optimistic echo, P2-15). */
	onSubmitSuccess?: (text: string) => void;
	onError?: (message: string | null, taskId: string | null) => void;
	/** External @mention insert (e.g. Teams workbench → back to task). */
	pendingMentionInsert?: AtItem | null;
	onPendingMentionConsumed?: () => void;
	/** External SkillSlash chip insert (e.g. Teams → `/team` / `/agent`). */
	pendingSlashInsert?: SlashItem | null;
	onPendingSlashConsumed?: () => void;
	sessionId?: string;
};

/**
 * Composer surface: draft lives only here (ADR-0006). Typing must not re-render Transcript.
 * Slash UX mirrors Codex: `/` opens Commands/Skills menu; pick → chip + args; submit → Bridge command.
 */
export const DialogueComposer = memo(function DialogueComposer({
	taskId = null,
	hasDrawerAbove = false,
	canChat,
	composerLocked,
	stopKind,
	canSubmitNow,
	canEnqueue,
	canSteer = false,
	model,
	modelDisplay,
	modelCatalog,
	stickyRunMode = 'agent',
	stickyEngineKind = 'fast',
	availableEngineIds = ['fast'],
	stickyEffort,
	stickyThinking,
	slashCatalog = [],
	slashCatalogHydrated = false,
	onSubmitSuccess,
	onError,
	pendingMentionInsert = null,
	onPendingMentionConsumed,
	pendingSlashInsert = null,
	onPendingSlashConsumed,
	sessionId
}: DialogueComposerProps) {
	const {t} = useTranslation();
	const [store] = useState(() => createTaskComposerDraftStore(taskId));
	const draft = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	const initialDraft = useRef(draft).current;
	const [sending, setSending] = useState(false);
	const [runMode, setRunMode] = useState<RunModeName>(stickyRunMode);
	const [engineKind, setEngineKind] = useState<EngineKindName>(() =>
		chromeEngineKind(taskId, stickyEngineKind)
	);
	const [modePopOpen, setModePopOpen] = useState(false);
	const [enginePopOpen, setEnginePopOpen] = useState(false);
	const [modelPopOpen, setModelPopOpen] = useState(false);
	const [thinkingPopOpen, setThinkingPopOpen] = useState(false);
	const [modelSearch, setModelSearch] = useState('');
	const [effort, setEffort] = useState<string | undefined>(stickyEffort);
	const [thinking, setThinking] = useState(stickyThinking ?? true);
	const [optimisticModelId, setOptimisticModelId] = useState<string | null>(null);
	const dshModels = useDshModels();
	const dshSkillRows = useDshSkills();
	const [dshSkillsReady, setDshSkillsReady] = useState(false);
	const dshBlocked = engineKind === 'dsh' && dshModels.routable === false;
	const slashRows = engineKind === 'dsh' ? dshSkillRows : slashCatalog;
	const slashHydrated = engineKind === 'dsh' ? dshSkillsReady : slashCatalogHydrated;

	useEffect(() => {
		if (engineKind !== 'dsh') {
			setDshSkillsReady(false);
			return;
		}
		void refreshDshSkills(sessionId).finally(() => setDshSkillsReady(true));
	}, [engineKind, sessionId]);

	/** Fast catalog: prefetch on mount / Task change — do not wait for the picker click. */
	useEffect(() => {
		if (engineKind === 'dsh') return;
		void window.fastIde.requestModelList();
	}, [engineKind, taskId]);

	// Re-sync chrome only when the Task identity changes. Depending on sticky*
	// here (including engineKind) reverted an optimistic pickEngine: the prop
	// lags the local state by one host round-trip, so a fast pick was clobbered
	// back to the stale dsh chrome.
	const resyncTaskRef = useRef<string | null>(taskId ?? null);
	useEffect(() => {
		if (!shouldResyncChrome(resyncTaskRef.current, taskId)) return;
		resyncTaskRef.current = taskId ?? null;
		setRunMode(stickyRunMode);
		setEngineKind(chromeEngineKind(taskId, stickyEngineKind));
		setEffort(stickyEffort);
		setThinking(stickyThinking ?? true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [taskId]);

	useEffect(() => {
		if (
			optimisticModelId &&
			(sameModelRef(model, optimisticModelId) || sameModelRef(modelDisplay, optimisticModelId))
		) {
			setOptimisticModelId(null);
		}
	}, [model, modelDisplay, optimisticModelId]);

	useEffect(() => {
		setOptimisticModelId(null);
	}, [taskId]);

	const [selectedSlash, setSelectedSlash] = useState<SlashItem | null>(null);
	const [slashHighlight, setSlashHighlight] = useState(0);
	const [atHighlight, setAtHighlight] = useState(0);
	/** Local fallback when Bridge never hydrates (stale Engine / hung /skills). */
	const [mentionChips, setMentionChips] = useState<MentionChip[]>([]);
	/** Text before caret in rich input (chips → refs) for @ suggest. */
	const [mentionBeforeCaret, setMentionBeforeCaret] = useState('');
	const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
	const [attachNotice, setAttachNotice] = useState<string | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const richRef = useRef<MentionRichInputHandle>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const slashChipRef = useRef<HTMLSpanElement>(null);
	const slashMenuListRef = useRef<HTMLDivElement>(null);
	const atMenuListRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setPendingImages(prev => {
			revokePending(prev);
			return [];
		});
		setAttachNotice(null);
	}, [taskId]);

	const composerDisabled = !canChat || sending || composerLocked;
	const slashQ = selectedSlash ? null : slashQuery(draft);
	const atQ =
		selectedSlash || slashQ !== null ? null : atQuery(mentionBeforeCaret || draft);
	const slashMenuOpen = slashQ !== null && !composerDisabled;
	const atMenuOpen = atQ !== null && !composerDisabled;
	const {slashMenuGroups, slashSkillsEmpty, flatSlashMenu, skillsTimedOut} = useSlashCatalog({
		slashRows,
		slashQ,
		engineKind,
		slashMenuOpen,
		slashHydrated
	});
	const {mentionGroups, setMentionGroups, mentionsWarming, flatAtMenu, atMenuByKind} =
		useMentionSuggest({
			pendingMentionInsert,
			onPendingMentionConsumed,
			selectedSlash,
			setSelectedSlash,
			store,
			richRef,
			composerDisabled,
			mentionBeforeCaret,
			draft,
			atMenuOpen,
			setMentionChips,
			setMentionBeforeCaret
		});
	const {slashChipIndent} = useMenuScroll({
		slashMenuOpen,
		atMenuOpen,
		slashHighlight,
		atHighlight,
		flatSlashLen: flatSlashMenu.length,
		flatAtLen: flatAtMenu.length,
		selectedSlash,
		slashMenuListRef,
		atMenuListRef,
		slashChipRef
	});

	useEffect(() => {
		if (composerLocked) {
			setModelPopOpen(false);
			setThinkingPopOpen(false);
			setSelectedSlash(null);
		}
	}, [composerLocked]);

	useEffect(() => {
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			if (thinkingPopOpen) {
				e.preventDefault();
				e.stopPropagation();
				setThinkingPopOpen(false);
				return;
			}
			if (modelPopOpen) {
				e.preventDefault();
				e.stopPropagation();
				setModelPopOpen(false);
				return;
			}
			if (selectedSlash) {
				e.preventDefault();
				e.stopPropagation();
				store.setDraft(`/${selectedSlash.name}`);
				setSelectedSlash(null);
			}
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	}, [thinkingPopOpen, modelPopOpen, selectedSlash, store]);

	useEffect(() => {
		setSlashHighlight(0);
	}, [slashQ, flatSlashMenu.length]);

	useEffect(() => {
		setAtHighlight(0);
	}, [atQ, flatAtMenu.length]);

	useEffect(() => {
		if (!taskId) return;
		// The draft store is Task-scoped and survives this keyed remount. Clearing
		// the editor here immediately overwrote that remembered draft on A→B→A.
		richRef.current?.restore(initialDraft, []);
		setMentionChips([]);
		setMentionGroups([]);
		setMentionBeforeCaret(initialDraft);
	}, [taskId, initialDraft]);

	const effectiveModel = optimisticModelId ?? model;
	const activeModelEntry = useMemo(
		() =>
			modelCatalog.find(e => matchCatalogEntry(e, effectiveModel)) ??
			(!optimisticModelId && modelDisplay
				? modelCatalog.find(e => matchCatalogEntry(e, modelDisplay))
				: undefined) ??
			(!optimisticModelId ? modelCatalog.find(e => e.current) : undefined),
		[modelCatalog, effectiveModel, optimisticModelId, modelDisplay]
	);
	const activeProvider = useMemo(
		() => (activeModelEntry ? catalogProvider(activeModelEntry) : undefined),
		[activeModelEntry]
	);
	const activeBrand = activeProvider?.brand;
	const supportedEfforts = activeModelEntry?.supportedEfforts ?? [];
	const supportsThinking = activeModelEntry?.supportsThinking === true;
	const canAttachImages = supportsImageInput(activeModelEntry);
	const modelButtonFull = useMemo(() => {
		const catalogDisplay = activeModelEntry?.display ?? '';
		if (!isUnresolvedModelDisplay(catalogDisplay)) return catalogDisplay;
		if (optimisticModelId && !isUnresolvedModelDisplay(optimisticModelId)) {
			return concreteModelDisplay(optimisticModelId);
		}
		if (!isUnresolvedModelDisplay(modelDisplay)) return modelDisplay;
		if (!isUnresolvedModelDisplay(model)) return concreteModelDisplay(model);
		const catalogCurrent = modelCatalog.find(e => e.current)?.display ?? '';
		if (!isUnresolvedModelDisplay(catalogCurrent)) return catalogCurrent;
		const first = modelCatalog[0]?.display ?? '';
		if (!isUnresolvedModelDisplay(first)) return first;
		return '';
	}, [activeModelEntry?.display, optimisticModelId, modelDisplay, model, modelCatalog]);

	const modelButtonLabel = useMemo(() => {
		// Short chip text — full platform/model was flex-shrunk to an empty chevron-only button.
		return composerModelLabel(effectiveModel, modelButtonFull);
	}, [modelButtonFull, effectiveModel]);

	const thinkingButtonLabel = useMemo(() => {
		if (!supportsThinking && supportedEfforts.length === 0) return '';
		if (!thinking) return t('shell.composer.thinkingOff', {defaultValue: '思考 · 关'});
		if (supportedEfforts.length > 0 && effort) {
			return `${t('shell.composer.thinking', {defaultValue: '思考'})} · ${EFFORT_LABEL[effort] ?? effort}`;
		}
		return t('shell.composer.thinkingOn', {defaultValue: '思考 · 开'});
	}, [supportsThinking, supportedEfforts.length, thinking, effort, t]);

	useEffortClamp({
		activeModelEntry,
		effort,
		setEffort,
		thinking,
		setThinking,
		supportedEfforts,
		supportsThinking
	});

	async function pickModel(id: string) {
		setOptimisticModelId(id);
		setModelPopOpen(false);
		setModelSearch('');
		const entry =
			modelCatalog.find(e => matchCatalogEntry(e, id)) ?? modelCatalog.find(e => e.id === id);
		if (!entry) {
			void window.fastIde.selectModel(id);
			return;
		}
		const {platform, model: catalogModel} = platformModel(entry);
		const nextEffort = clampEffort(effort, entry.supportedEfforts ?? [], entry.defaultEffort);
		const nextThinking = entry.supportsThinking === true ? (thinking ?? true) : false;
		setEffort(nextEffort);
		setThinking(nextThinking);
		void Promise.all([
			window.fastIde.selectModel(entry.id),
			persistModelSettings(platform, catalogModel, nextEffort, nextThinking)
		]);
	}

	async function pickMode(mode: RunModeName) {
		setModePopOpen(false);
		setRunMode(mode);
		await window.fastIde.setRunMode(mode, taskId);
		const next =
			mode === 'plan' ? ensurePlanPrefix(draft) : stripAutoPlanPrefix(draft);
		store.setDraft(next);
		if (!selectedSlash) {
			richRef.current?.restore(next, mentionChips);
			setMentionBeforeCaret(next);
		}
	}

	async function pickEngine(kind: EngineKindName) {
		setEnginePopOpen(false);
		rememberEnginePick(taskId, kind);
		setEngineKind(kind);
		await window.fastIde.setEngineKind(kind, taskId);
	}

	async function pickEffort(next: string) {
		setEffort(next);
		setThinkingPopOpen(false);
		const entry = activeModelEntry;
		if (!entry) return;
		const {platform, model: catalogModel} = platformModel(entry);
		void persistModelSettings(platform, catalogModel, next, thinking);
	}

	async function toggleThinking(next: boolean) {
		setThinking(next);
		const entry = activeModelEntry;
		if (!entry) return;
		const {platform, model: catalogModel} = platformModel(entry);
		void persistModelSettings(platform, catalogModel, effort, next);
	}

	function pickSlash(item: SlashItem) {
		richRef.current?.clear();
		setMentionChips([]);
		setMentionBeforeCaret('');
		setSelectedSlash(item);
		store.setDraft('');
		requestAnimationFrame(() => textareaRef.current?.focus());
	}

	// Teams → Composer SkillSlash chip (`/team` / `/agent`).
	useEffect(() => {
		if (!pendingSlashInsert) return;
		pickSlash(pendingSlashInsert);
		onPendingSlashConsumed?.();
	}, [pendingSlashInsert, onPendingSlashConsumed]);

	// Starter prompt or external text insert event
	useEffect(() => {
		const onInsertText = (e: Event) => {
			const customEvent = e as CustomEvent<{text: string}>;
			const text = customEvent.detail?.text;
			if (!text) return;
			if (selectedSlash) {
				setSelectedSlash(null);
			}
			richRef.current?.clear();
			setMentionChips([]);
			setMentionBeforeCaret('');
			richRef.current?.restore(text, []);
			store.setDraft(text);
			requestAnimationFrame(() => {
				richRef.current?.focus();
			});
		};
		window.addEventListener('fast-ide:insert-composer-text', onInsertText);
		return () => {
			window.removeEventListener('fast-ide:insert-composer-text', onInsertText);
		};
	}, [selectedSlash, store]);

	function pickAt(item: AtItem) {
		const snap = richRef.current?.insertChip(item);
		if (snap) {
			store.setDraft(snap.text);
			setMentionChips(snap.chips);
			setMentionBeforeCaret(snap.beforeCaret);
		}
		setMentionGroups([]);
		requestAnimationFrame(() => richRef.current?.focus());
	}

	function takeFiles(files: File[], opts?: {fromPaste?: boolean}) {
		void ingestFiles(files, {
			fromPaste: opts?.fromPaste,
			canAttachImages,
			pendingImages,
			unsupportedNotice: t('shell.composer.imageNotSupported'),
			pickAt,
			setPendingImages,
			setAttachNotice
		});
	}

	function pasteFiles(files: File[]) {
		takeFiles(files, {fromPaste: true});
	}

	function removePending(id: string) {
		setPendingImages(prev => {
			const hit = prev.find(p => p.id === id);
			if (hit) URL.revokeObjectURL(hit.previewUrl);
			return prev.filter(p => p.id !== id);
		});
	}

	function clearSlashChip() {
		if (!selectedSlash) return;
		const name = selectedSlash.name;
		setSelectedSlash(null);
		store.setDraft(`/${name}`);
		requestAnimationFrame(() => richRef.current?.focus());
	}

	function onRichChange(snap: {
		text: string;
		chips: MentionChip[];
		beforeCaret: string;
	}) {
		store.setDraft(snap.text);
		setMentionChips(snap.chips);
		setMentionBeforeCaret(snap.beforeCaret);
	}

	async function submitText(
		text: string,
		restoreDraft: string,
		restoreSlash: SlashItem | null,
		restoreChips: MentionChip[],
		mentions?: MentionChip[]
	) {
		const hasImages = pendingImages.some(p => !p.rejectReason && p.data);
		if (!text && !hasImages) return;
		// Hand-typed `/plan …` or `/mode <m>` keeps Mode UI in sync with Engine sticky SetMode.
		const slashName = text.match(/^\/([^\s]+)/)?.[1]?.toLowerCase();
		const modeArg = text.match(/^\/mode\s+(agent|plan|ask|yolo)\b/i)?.[1]?.toLowerCase() as
			| RunModeName
			| undefined;
		if (engineKind !== 'dsh') {
			if (modeArg && modeArg !== runMode) {
				setRunMode(modeArg);
				await window.fastIde.setRunMode(modeArg, taskId);
			} else if (slashName === 'plan' && runMode !== 'plan') {
				setRunMode('plan');
				await window.fastIde.setRunMode('plan', taskId);
			}
		}
		setSending(true);
		onError?.(null, taskId);
		store.clear();
		setSelectedSlash(null);
		setMentionChips([]);
		setMentionBeforeCaret('');
		setMentionGroups([]);
		const imagesWire = pendingImages
			.filter(p => !p.rejectReason && p.data)
			.map(p => ({mediaType: p.mediaType, data: p.data, name: p.name}));
		const restoreImages = pendingImages;
		setPendingImages([]);
		richRef.current?.clear();
		onSubmitSuccess?.(text);
		const result = await window.fastIde.sendMessage(
			text,
			mentions && mentions.length > 0 ? mentions : undefined,
			taskId,
			imagesWire.length > 0 ? imagesWire : undefined
		);
		if (!result.ok) {
			setPendingImages(restoreImages);
			store.restore(restoreDraft);
			setSelectedSlash(restoreSlash);
			setMentionChips(restoreChips);
			if (restoreSlash) {
				requestAnimationFrame(() => textareaRef.current?.focus());
			} else {
				richRef.current?.restore(restoreDraft, restoreChips);
				setMentionBeforeCaret(restoreDraft);
				requestAnimationFrame(() => richRef.current?.focus());
			}
			onError?.(
				helpNoticeText(result.notice ?? 'errors.send.failed', t),
				taskId
			);
		} else {
			revokePending(restoreImages);
			if (result.notice) {
				onError?.(helpNoticeText(result.notice, t), taskId);
			}
		}
		if (result.openModelPicker) {
			setModelSearch('');
			setModelPopOpen(true);
			void window.fastIde.requestModelList();
		}
		setSending(false);
	}

	async function onSubmit(event: FormEvent) {
		event.preventDefault();
		if (!canChat || sending || composerLocked || dshBlocked || (!canSubmitNow && !canEnqueue)) return;
		const snap = selectedSlash ? null : richRef.current?.snapshot();
		const text = selectedSlash
			? formatSlashSubmit(selectedSlash.name, draft)
			: (snap?.text ?? draft).trim();
		const chips = selectedSlash ? [] : (snap?.chips ?? mentionChips);
		const restoreBody = selectedSlash ? draft : (snap?.text ?? draft);
		const hasImages = pendingImages.some(p => !p.rejectReason && p.data);
		if (!text && !hasImages) return;
		await submitText(text, restoreBody, selectedSlash, chips, chips);
	}

	function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement | HTMLDivElement>) {
		handleComposerKeyDown(e, {
			slashMenuOpen,
			flatSlashMenu,
			slashHighlight,
			setSlashHighlight,
			slashQ,
			pickSlash,
			atMenuOpen,
			flatAtMenu,
			atHighlight,
			setAtHighlight,
			atQ,
			pickAt,
			selectedSlash,
			draft,
			clearSlashChip,
			onSubmit
		});
	}

	const hasSendableImages = pendingImages.some(p => !p.rejectReason && p.data);
	const canSend =
		!composerDisabled &&
		!dshBlocked &&
		(canSubmitNow || canEnqueue) &&
		Boolean(selectedSlash || draft.trim() || mentionChips.length > 0 || hasSendableImages);

	const slashCmdValue =
		flatSlashMenu[slashHighlight] != null
			? `${flatSlashMenu[slashHighlight].kind}:${flatSlashMenu[slashHighlight].name}`
			: '';
	const atCmdValue = flatAtMenu[atHighlight]?.ref ?? '';

	return (
		<form
			className={cn('shrink-0 space-y-2', composerLocked && 'opacity-90')}
			onSubmit={onSubmit}
		>
			{slashMenuOpen && (
				<SlashMenu
					slashCmdValue={slashCmdValue}
					flatSlashMenu={flatSlashMenu}
					slashMenuGroups={slashMenuGroups}
					slashHydrated={slashHydrated}
					skillsTimedOut={skillsTimedOut}
					slashSkillsEmpty={slashSkillsEmpty}
					slashRowsLength={slashRows.length}
					listRef={slashMenuListRef}
					onHighlight={setSlashHighlight}
					onPick={pickSlash}
				/>
			)}

			{atMenuOpen && (
				<AtMenu
					atCmdValue={atCmdValue}
					flatAtMenu={flatAtMenu}
					atMenuByKind={atMenuByKind}
					mentionsWarming={mentionsWarming}
					listRef={atMenuListRef}
					onHighlight={setAtHighlight}
					onPick={pickAt}
				/>
			)}

			<div
				className={cn('bg-background', hasDrawerAbove ? 'rounded-b-3xl' : 'rounded-3xl')}
				onDragOver={e => {
					if (!e.dataTransfer.types.includes('Files')) return;
					e.preventDefault();
				}}
				onDrop={e => {
					if (!e.dataTransfer.files?.length) return;
					e.preventDefault();
					takeFiles(Array.from(e.dataTransfer.files));
				}}
			>
				{engineKind === 'dsh' ? <DshNotice /> : null}
				<ImageDrawer
					pendingImages={pendingImages}
					attachNotice={attachNotice}
					fileInputRef={fileInputRef}
					onRemove={removePending}
					onPickFiles={takeFiles}
				/>
				<InputGroup
					className={cn(
						'rounded-none border-0 bg-transparent shadow-none',
						'has-[[data-slot=input-group-control]:focus-visible]:border-0',
						'has-[[data-slot=input-group-control]:focus-visible]:ring-0'
					)}
				>
					{selectedSlash ? (
						<div className="relative w-full px-4 pt-3">
							<span
								ref={slashChipRef}
								className={cn(
									'absolute left-4 top-3 z-10 inline-flex max-w-[min(100%,20rem)]',
									'items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium',
									SYSTEM_BLUE_CHIP
								)}
							>
								<Boxes className="size-3.5 shrink-0" />
								<span className="truncate">{selectedSlash.label}</span>
								<button
									type="button"
									className="rounded-sm p-0.5 opacity-60 hover:opacity-100"
									aria-label={t('shell.composer.removeSkill')}
									onMouseDown={e => e.preventDefault()}
									onClick={clearSlashChip}
								>
									<X className="size-3" />
								</button>
							</span>
							<InputGroupTextarea
								ref={textareaRef}
								value={draft}
								onChange={e => store.setDraft(e.target.value)}
								placeholder={t('shell.composer.skillPlaceholder')}
								disabled={composerDisabled}
								rows={2}
								style={
									slashChipIndent > 0 ? {textIndent: slashChipIndent} : undefined
								}
								className="min-h-10 w-full border-0 px-0 py-1 text-[13px] leading-relaxed shadow-none focus-visible:ring-0"
								onKeyDown={onComposerKeyDown}
							/>
						</div>
					) : (
						<div className="relative w-full px-4 pt-3">
							<MentionRichInput
								ref={richRef}
								disabled={composerDisabled}
								placeholder={
									!canChat
										? t('shell.composer.needProject')
										: t('shell.composer.placeholder')
								}
								onChange={onRichChange}
								onKeyDown={onComposerKeyDown}
								onPasteFiles={pasteFiles}
							/>
						</div>
					)}
					<ActionStrip
						{...{
							composerDisabled, canAttachImages, setAttachNotice, fileInputRef,
							enginePopOpen, setEnginePopOpen, engineKind, availableEngineIds, pickEngine,
							modePopOpen, setModePopOpen, runMode, pickMode, sessionId,
							modelPopOpen, setModelPopOpen, modelButtonFull, modelButtonLabel, activeBrand,
							composerLocked, canChat, setModelSearch, modelCatalog, modelSearch,
							effectiveModel, pickModel, thinkingPopOpen, setThinkingPopOpen,
							supportsThinking, supportedEfforts, thinking, thinkingButtonLabel, effort,
							toggleThinking, pickEffort, stopKind, canSteer, canSubmitNow, canSend,
							selectedSlash, richRef, draft, store
						}}
					/>

				</InputGroup>
			</div>
			{composerLocked ? (
				<p className="px-4 pb-3 text-xs text-muted-foreground">
					{t('shell.composer.resolveGate')}
				</p>
			) : null}
		</form>
	);
});
