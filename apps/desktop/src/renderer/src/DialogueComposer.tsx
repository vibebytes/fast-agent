import {
	memo,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type FormEvent,
	type KeyboardEvent
} from 'react';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList
} from '@fast-ide/ui/components/command';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea
} from '@fast-ide/ui/components/input-group';
import {Popover, PopoverContent, PopoverTrigger} from '@fast-ide/ui/components/popover';
import {cn} from '@fast-ide/ui/lib/utils';
import {
	ArrowUp,
	ArrowUpRight,
	Bot,
	Boxes,
	Brain,
	BrainCircuit,
	Check,
	ChevronDown,
	ChevronRight,
	Layers,
	Plus,
	Search,
	SearchX,
	Settings,
	SlidersHorizontal,
	Sparkles,
	Square,
	X,
	Zap
} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {createTaskComposerDraftStore} from './composerDraft';
import {ModelMenu} from './dsh/composer/ModelMenu';
import {Notice as DshNotice} from './dsh/composer/Notice';
import {useDshModels} from './dsh/composer/models';
import {refreshDshSkills, useDshSkills} from './dsh/skills/skills';
import type {MentionChip, ModelCatalogEntry, SlashCatalogEntry} from './env';
import {getProviderBrand, getModelCapabilityBadges} from './modelBrand';
import {
	atSuggestPrefix,
	atQuery,
	exactAtMatch,
	groupAtItems,
	groupsToAtItems,
	kindTitle,
	type AtItem,
	type MentionSuggestGroup
} from './atCatalog';
import {
	MentionRichInput,
	type MentionRichInputHandle
} from './MentionRichInput';
import {
	exactSlashMatch,
	filterSlashMenu,
	flattenSlashMenu,
	formatSlashSubmit,
	HOST_SLASH_COMMANDS,
	skillsFromCatalog,
	slashQuery,
	type SlashItem
} from './slashCatalog';
import {ensurePlanPrefix, stripAutoPlanPrefix} from './planPrefix';
import {clampEffort} from './effortClamp';
import {platformModel} from './composerPlatform';
import {helpNoticeText} from './helpNoticeText';
import {composerModelLabel, concreteModelDisplay, isUnresolvedModelDisplay} from '../../shared/defaultModel';
import {matchCatalogEntry, sameModelRef} from '../../shared/modelMatch';
import {enginePickerKinds, type EngineKindName} from './enginePicker';

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
	openrouter: 'OpenRouter',
	deepseek: 'DeepSeek',
	anthropic: 'Anthropic',
	openai: 'OpenAI',
	zhipu: '智谱 GLM',
	moonshot: 'Moonshot',
	volcesark: '火山引擎',
	volcengine: '火山引擎',
	ollama: 'Ollama',
	local: 'Local'
};

function formatProviderTitle(key: string): string {
	const k = key.toLowerCase().trim();
	if (PROVIDER_DISPLAY_NAMES[k]) return PROVIDER_DISPLAY_NAMES[k];
	if (!key || key === 'default') return 'Other';
	return key.charAt(0).toUpperCase() + key.slice(1);
}

function parseCatalogEntry(entry: ModelCatalogEntry) {
	const idParts = entry.id.split('/');
	const providerKey = idParts.length > 1 ? idParts[0]! : 'default';
	const fromId = idParts.length > 1 ? idParts.slice(1).join('/') : entry.id;
	const cleanName =
		entry.display && !entry.display.includes('/') ? entry.display : fromId;
	return {providerKey, cleanName};
}

type CatalogGroup = {
	providerKey: string;
	providerLabel: string;
	items: Array<{
		entry: ModelCatalogEntry;
		cleanName: string;
	}>;
};

function groupCatalogEntries(entries: ModelCatalogEntry[]): CatalogGroup[] {
	const map = new Map<string, Array<{ entry: ModelCatalogEntry; cleanName: string }>>();
	for (const entry of entries) {
		const { providerKey, cleanName } = parseCatalogEntry(entry);
		const list = map.get(providerKey) ?? [];
		list.push({ entry, cleanName });
		map.set(providerKey, list);
	}

	const groups: CatalogGroup[] = [];
	for (const [providerKey, items] of map.entries()) {
		const brand = getProviderBrand(providerKey);
		groups.push({
			providerKey,
			providerLabel: brand.name,
			items
		});
	}
	return groups;
}

/** System blue accent (CONTEXT: #007AFF / #0A84FF). */
const SYSTEM_BLUE = 'text-[#007AFF] dark:text-[#0A84FF]';
const SYSTEM_BLUE_CHIP =
	'bg-[#007AFF]/10 text-[#007AFF] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]';

const KNOWN_SLASH_BADGES = new Set(['personal', 'builtin', 'project']);

const RUN_MODES = ['agent', 'plan', 'ask', 'yolo'] as const;
type RunModeName = (typeof RUN_MODES)[number];

const EFFORT_LABEL: Record<string, string> = {
	low: 'Low',
	medium: 'Medium',
	high: 'High',
	xhigh: 'Extra',
	max: 'Max'
};

/** Scroll `data-menu-idx` row into the CommandList scrollport (not page / not cmdk first-selected). */
function scrollMenuItemIntoView(list: HTMLElement | null, idx: number): void {
	if (!list || idx < 0) return;
	const el = list.querySelector<HTMLElement>(`[data-menu-idx="${idx}"]`);
	if (!el) return;
	const cRect = list.getBoundingClientRect();
	const eRect = el.getBoundingClientRect();
	if (eRect.top < cRect.top) list.scrollTop -= cRect.top - eRect.top;
	else if (eRect.bottom > cRect.bottom) list.scrollTop += eRect.bottom - cRect.bottom;
}

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
	const [engineKind, setEngineKind] = useState<EngineKindName>(stickyEngineKind);
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

	useEffect(() => {
		setRunMode(stickyRunMode);
		setEngineKind(stickyEngineKind);
		setEffort(stickyEffort);
		setThinking(stickyThinking ?? true);
		if (
			optimisticModelId &&
			(sameModelRef(model, optimisticModelId) || sameModelRef(modelDisplay, optimisticModelId))
		) {
			setOptimisticModelId(null);
		}
	}, [taskId, stickyRunMode, stickyEngineKind, stickyEffort, stickyThinking, model, modelDisplay, optimisticModelId]);

	useEffect(() => {
		setOptimisticModelId(null);
	}, [taskId]);

	const [selectedSlash, setSelectedSlash] = useState<SlashItem | null>(null);
	const [slashHighlight, setSlashHighlight] = useState(0);
	const [atHighlight, setAtHighlight] = useState(0);
	/** Local fallback when Bridge never hydrates (stale Engine / hung /skills). */
	const [skillsTimedOut, setSkillsTimedOut] = useState(false);
	const [mentionChips, setMentionChips] = useState<MentionChip[]>([]);
	/** Text before caret in rich input (chips → refs) for @ suggest. */
	const [mentionBeforeCaret, setMentionBeforeCaret] = useState('');
	const [mentionGroups, setMentionGroups] = useState<MentionSuggestGroup[]>([]);
	const [mentionRequestId, setMentionRequestId] = useState<string | null>(null);
	const [mentionsWarming, setMentionsWarming] = useState(false);
	const pendingMentionId = useRef<string | null>(null);
	const mentionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const richRef = useRef<MentionRichInputHandle>(null);
	const slashChipRef = useRef<HTMLSpanElement>(null);
	const slashMenuListRef = useRef<HTMLDivElement>(null);
	const atMenuListRef = useRef<HTMLDivElement>(null);
	/** First-line indent so args wrap under the chip (native textarea can't share line boxes). */
	const [slashChipIndent, setSlashChipIndent] = useState(0);

	// Teams → Composer @ insert: only consume pending when a chip/ref lands; rAF retry if rich input not ready.
	useEffect(() => {
		if (!pendingMentionInsert) return;
		let cancelled = false;
		let attempts = 0;
		const item = pendingMentionInsert;
		const tryInsert = () => {
			if (cancelled) return;
			if (selectedSlash) {
				setSelectedSlash(null);
				store.setDraft('');
				requestAnimationFrame(tryInsert);
				return;
			}
			const snap = richRef.current?.insertChip(item);
			const ok = Boolean(
				snap && (snap.chips.length > 0 || /@[A-Za-z0-9_./:-]+/.test(snap.text))
			);
			if (ok && snap) {
				store.setDraft(snap.text);
				setMentionChips(snap.chips);
				setMentionBeforeCaret(snap.beforeCaret);
				onPendingMentionConsumed?.();
				return;
			}
			if (attempts < 8) {
				attempts += 1;
				requestAnimationFrame(tryInsert);
				return;
			}
			// Keep pending — do not clear; next mount / effect can retry.
		};
		tryInsert();
		return () => {
			cancelled = true;
		};
	}, [pendingMentionInsert, onPendingMentionConsumed, store, selectedSlash]);

	const composerDisabled = !canChat || sending || composerLocked;
	const skills = useMemo(
		() => skillsFromCatalog(slashRows),
		[slashRows]
	);
	const slashQ = selectedSlash ? null : slashQuery(draft);
	const atQ =
		selectedSlash || slashQ !== null ? null : atQuery(mentionBeforeCaret || draft);
	const slashMenuOpen = slashQ !== null && !composerDisabled;
	const atMenuOpen = atQ !== null && !composerDisabled;
	const slashMenuGroups = useMemo(
		() =>
			slashQ === null
				? {commands: [], platform: [], coding: [], external: []}
				: filterSlashMenu(slashQ, skills, engineKind === 'dsh' ? [] : HOST_SLASH_COMMANDS),
		[slashQ, skills, engineKind]
	);
	const slashSkillsEmpty =
		slashMenuGroups.platform.length === 0 &&
		slashMenuGroups.coding.length === 0 &&
		slashMenuGroups.external.length === 0;
	const flatSlashMenu = useMemo(() => flattenSlashMenu(slashMenuGroups), [slashMenuGroups]);
	const flatAtMenu = useMemo(() => {
		if (!atMenuOpen) return [] as AtItem[];
		if (mentionRequestId != null && pendingMentionId.current != null
			&& mentionRequestId !== pendingMentionId.current) {
			return [] as AtItem[];
		}
		return groupsToAtItems(mentionGroups);
	}, [atMenuOpen, mentionGroups, mentionRequestId]);
	const atMenuByKind = useMemo(() => groupAtItems(flatAtMenu), [flatAtMenu]);

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

	// Textarea owns focus; cmdk selection is controlled via `value`. Scroll the active row
	// inside CommandList (do not query [data-selected] — cmdk may lag one frame).
	useLayoutEffect(() => {
		if (!slashMenuOpen) return;
		scrollMenuItemIntoView(slashMenuListRef.current, slashHighlight);
	}, [slashHighlight, slashMenuOpen, flatSlashMenu.length]);

	useLayoutEffect(() => {
		if (!atMenuOpen) return;
		scrollMenuItemIntoView(atMenuListRef.current, atHighlight);
	}, [atHighlight, atMenuOpen, flatAtMenu.length]);

	/** Refresh Catalog skills when slash picker opens (not @ — Mentions is authority). */
	useEffect(() => {
		if (!slashMenuOpen) return;
		setSkillsTimedOut(false);
		void window.fastIde.requestSlashCatalog();
		const t = window.setTimeout(() => setSkillsTimedOut(true), 8_000);
		return () => window.clearTimeout(t);
	}, [slashMenuOpen]);

	/** Debounced Bridge MentionSuggest while `@…` token is active. */
	useEffect(() => {
		if (!atMenuOpen || composerDisabled) {
			setMentionGroups([]);
			setMentionsWarming(false);
			return;
		}
		const prefix = atSuggestPrefix(mentionBeforeCaret || draft);
		if (prefix == null) return;
		if (mentionTimer.current) clearTimeout(mentionTimer.current);
		setMentionsWarming(true);
		mentionTimer.current = setTimeout(() => {
			const requestId = `ms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			pendingMentionId.current = requestId;
			void window.fastIde.mentionSuggest(prefix, requestId);
		}, 120);
		return () => {
			if (mentionTimer.current) clearTimeout(mentionTimer.current);
		};
	}, [atMenuOpen, composerDisabled, mentionBeforeCaret, draft]);

	useEffect(() => {
		return window.fastIde.onBridgeEvent(payload => {
			const event = payload.event as {
				type?: string;
				requestId?: string;
				groups?: MentionSuggestGroup[];
			};
			if (event.type !== 'mention_suggestions' || !event.requestId) return;
			if (
				pendingMentionId.current != null &&
				event.requestId !== pendingMentionId.current
			) {
				return;
			}
			setMentionRequestId(event.requestId);
			setMentionGroups(event.groups ?? []);
			setMentionsWarming(false);
		});
	}, []);

	useEffect(() => {
		if (!taskId) return;
		// The draft store is Task-scoped and survives this keyed remount. Clearing
		// the editor here immediately overwrote that remembered draft on A→B→A.
		richRef.current?.restore(initialDraft, []);
		setMentionChips([]);
		setMentionGroups([]);
		setMentionBeforeCaret(initialDraft);
	}, [taskId, initialDraft]);

	useEffect(() => {
		if (slashHydrated || slashRows.length > 0) setSkillsTimedOut(false);
	}, [slashHydrated, slashRows.length]);

	useLayoutEffect(() => {
		if (!selectedSlash) {
			setSlashChipIndent(0);
			return;
		}
		const el = slashChipRef.current;
		if (!el) return;
		const gap = 8;
		const sync = () => setSlashChipIndent(el.offsetWidth + gap);
		sync();
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		return () => ro.disconnect();
	}, [selectedSlash, selectedSlash?.label]);

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
	const activeProviderKey = useMemo(() => {
		if (!activeModelEntry) return 'default';
		return parseCatalogEntry(activeModelEntry).providerKey;
	}, [activeModelEntry]);
	const activeBrand = useMemo(() => getProviderBrand(activeProviderKey), [activeProviderKey]);
	const supportedEfforts = activeModelEntry?.supportedEfforts ?? [];
	const supportsThinking = activeModelEntry?.supportsThinking === true;
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

	const getEffortDesc = (e: string) => {
		switch (e) {
			case 'low':
				return t('shell.composer.effortLow', {defaultValue: '快速轻量，日常对话'});
			case 'medium':
				return t('shell.composer.effortMedium', {defaultValue: '均衡推荐，日常编码'});
			case 'high':
				return t('shell.composer.effortHigh', {defaultValue: '深度分析，复杂难题'});
			case 'xhigh':
			case 'max':
				return t('shell.composer.effortExtra', {defaultValue: '极限算力，复杂推理'});
			default:
				return '';
		}
	};

	useEffect(() => {
		if (!activeModelEntry) return;
		const next = clampEffort(effort, supportedEfforts, activeModelEntry.defaultEffort);
		if (next !== effort) setEffort(next);
		if (!supportsThinking && thinking) setThinking(false);
		// Do not SetModelSettings(true) on mount — races selectTask and can overwrite Off.
		// Wire default On lives in SessionController.submitThinking when sticky unset.
	}, [activeModelEntry, supportedEfforts, supportsThinking]); // eslint-disable-line react-hooks/exhaustive-deps

	const filteredCatalog = useMemo(() => {
		if (!modelSearch.trim()) return modelCatalog;
		const q = modelSearch.trim().toLowerCase();
		return modelCatalog.filter(entry => {
			const {providerKey, cleanName} = parseCatalogEntry(entry);
			const brand = getProviderBrand(providerKey);
			return (
				cleanName.toLowerCase().includes(q) ||
				entry.display.toLowerCase().includes(q) ||
				entry.id.toLowerCase().includes(q) ||
				brand.name.toLowerCase().includes(q) ||
				brand.shortName.toLowerCase().includes(q) ||
				entry.aliases.some(a => a.toLowerCase().includes(q))
			);
		});
	}, [modelCatalog, modelSearch]);

	const groupedCatalog = useMemo(
		() => groupCatalogEntries(filteredCatalog),
		[filteredCatalog]
	);

	async function openModelPicker() {
		if (composerLocked || !canChat) return;
		setModelSearch('');
		setModelPopOpen(true);
		void window.fastIde.requestModelList();
	}

	async function persistModelSettings(
		platform: string,
		modelId: string,
		nextEffort?: string,
		nextThinking?: boolean
	) {
		await window.fastIde.setModelSettings({
			platform,
			model: modelId,
			...(nextEffort ? {effort: nextEffort} : {}),
			...(nextThinking !== undefined ? {thinking: nextThinking} : {})
		});
	}

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

	/** Paste attachments: real files become @file chips; pathless blobs (screenshots) are ignored. */
	function pasteFiles(files: File[]) {
		for (const f of files) {
			const p = window.fastIde.getPathForFile(f);
			if (!p) continue;
			pickAt({
				ref: `@file/${p}`,
				label: p.split(/[\\/]/).pop() || p,
				description: p,
				kind: 'file',
				locator: p
			});
		}
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
		if (!text) return;
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
		richRef.current?.clear();
		onSubmitSuccess?.(text);
		const result = await window.fastIde.sendMessage(
			text,
			mentions && mentions.length > 0 ? mentions : undefined,
			taskId
		);
		if (!result.ok) {
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
				helpNoticeText(result.notice ?? 'errors.send.workspace_not_ready', t),
				taskId
			);
		} else if (result.notice) {
			onError?.(helpNoticeText(result.notice, t), taskId);
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
		await submitText(text, restoreBody, selectedSlash, chips, chips);
	}

	function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement | HTMLDivElement>) {
		if (slashMenuOpen && flatSlashMenu.length > 0) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setSlashHighlight(i => (i + 1) % flatSlashMenu.length);
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				setSlashHighlight(i => (i - 1 + flatSlashMenu.length) % flatSlashMenu.length);
				return;
			}
			if (e.key === 'Tab') {
				e.preventDefault();
				const item = flatSlashMenu[slashHighlight] ?? flatSlashMenu[0];
				if (item) pickSlash(item);
				return;
			}
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				const item =
					exactSlashMatch(slashQ ?? '', flatSlashMenu) ??
					flatSlashMenu[slashHighlight] ??
					flatSlashMenu[0];
				if (item) pickSlash(item);
				return;
			}
		}

		if (atMenuOpen && flatAtMenu.length > 0) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setAtHighlight(i => (i + 1) % flatAtMenu.length);
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				setAtHighlight(i => (i - 1 + flatAtMenu.length) % flatAtMenu.length);
				return;
			}
			if (e.key === 'Tab') {
				e.preventDefault();
				const item = flatAtMenu[atHighlight] ?? flatAtMenu[0];
				if (item) pickAt(item);
				return;
			}
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				const item =
					exactAtMatch(atQ ?? '', flatAtMenu) ?? flatAtMenu[atHighlight] ?? flatAtMenu[0];
				if (item) pickAt(item);
				return;
			}
		}

		if (
			selectedSlash &&
			(e.key === 'Backspace' || e.key === 'Delete') &&
			draft.length === 0 &&
			!e.metaKey &&
			!e.ctrlKey
		) {
			e.preventDefault();
			clearSlashChip();
			return;
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void onSubmit(e as unknown as FormEvent);
		}
	}

	const canSend =
		!composerDisabled &&
		!dshBlocked &&
		(canSubmitNow || canEnqueue) &&
		Boolean(selectedSlash || draft.trim() || mentionChips.length > 0);

	const slashCmdValue =
		flatSlashMenu[slashHighlight] != null
			? `${flatSlashMenu[slashHighlight].kind}:${flatSlashMenu[slashHighlight].name}`
			: '';
	const atCmdValue = flatAtMenu[atHighlight]?.ref ?? '';

	function renderSlashMenuItem(item: SlashItem, idx: number) {
		return (
			<CommandItem
				key={`${item.kind}-${item.name}`}
				value={`${item.kind}:${item.name}`}
				data-menu-idx={idx}
				onMouseEnter={() => setSlashHighlight(idx)}
				onSelect={() => pickSlash(item)}
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

	function renderAtMenuItem(item: AtItem, idx: number) {
		return (
			<CommandItem
				key={item.ref}
				value={item.ref}
				data-menu-idx={idx}
				onMouseEnter={() => setAtHighlight(idx)}
				onSelect={() => pickAt(item)}
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
		<form
			className={cn('shrink-0 space-y-2', composerLocked && 'opacity-90')}
			onSubmit={onSubmit}
		>
			{slashMenuOpen && (
				<div className="absolute inset-x-0 bottom-full z-30 mb-1 overflow-hidden rounded-2xl border border-border/70 bg-popover shadow-lg">
					<Command
						shouldFilter={false}
						value={slashCmdValue}
						onValueChange={v => {
							const idx = flatSlashMenu.findIndex(
								i => `${i.kind}:${i.name}` === v
							);
							if (idx >= 0) setSlashHighlight(idx);
						}}
						className="max-h-80"
					>
						<CommandList ref={slashMenuListRef}>
							{/* Only when the whole menu is empty — avoid stacking with the skill-loading hint. */}
							{flatSlashMenu.length === 0 &&
								!(!slashHydrated && !skillsTimedOut && slashSkillsEmpty) && (
									<CommandEmpty>
										{slashRows.length === 0 ? t('shell.composer.noSkills') : t('shell.composer.noMatch')}
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
			)}

			{atMenuOpen && (
				<div className="absolute inset-x-0 bottom-full z-30 mb-1 overflow-hidden rounded-2xl border border-border/70 bg-popover shadow-lg">
					<Command
						shouldFilter={false}
						value={atCmdValue}
						onValueChange={v => {
							const idx = flatAtMenu.findIndex(i => i.ref === v);
							if (idx >= 0) setAtHighlight(idx);
						}}
						className="max-h-80"
					>
						<CommandList ref={atMenuListRef}>
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
			)}

			<div className={cn('bg-background', hasDrawerAbove ? 'rounded-b-3xl' : 'rounded-3xl')}>
				{engineKind === 'dsh' ? <DshNotice /> : null}
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
					<InputGroupAddon align="block-end" className="justify-between gap-2 px-3.5 pb-3 pt-1">
						<div className="flex items-center gap-1.5 min-w-0">
							<InputGroupButton
								type="button"
								size="icon-sm"
								variant="ghost"
								className="size-7 shrink-0 rounded-full text-muted-foreground/70 hover:bg-muted/70 hover:text-foreground transition-colors"
								disabled
								aria-label={t('shell.composer.addAttachment')}
								title={t('shell.common.comingSoon')}
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
											if (!modelPopOpen) void openModelPicker();
										}}
									>
										<span className={cn('size-2 rounded-full shrink-0', activeBrand.dotBg)} />
										<span className="truncate">{modelButtonLabel}</span>
										<ChevronDown
											className={cn(
												'size-3 shrink-0 opacity-60 transition-transform duration-200',
												modelPopOpen && 'rotate-180'
											)}
										/>
									</InputGroupButton>
								</PopoverTrigger>
								<PopoverContent
									className="w-[380px] max-w-[calc(100vw-24px)] p-0 shadow-2xl border border-border/80 rounded-2xl overflow-hidden bg-popover/98 backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-150 flex flex-col"
									align="start"
									sideOffset={8}
								>
									<div className="border-b border-border/60 bg-background/60 px-3 py-2">
										<div className="relative flex items-center">
											<Search className="size-3.5 text-muted-foreground/80 shrink-0 mr-2" />
											<input
												type="text"
												placeholder={t('shell.composer.searchModelsPlaceholder', {
													defaultValue: '搜索模型名称、ID 或提供商…'
												})}
												value={modelSearch}
												onChange={e => setModelSearch(e.target.value)}
												className="h-6 w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 outline-none"
												autoFocus
											/>
											{modelSearch.trim() && (
												<button
													type="button"
													onClick={() => setModelSearch('')}
													className="size-5 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer mr-1"
													aria-label="Clear search"
												>
													<X className="size-3" />
												</button>
											)}
											{modelSearch.trim() && (
												<span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
													{filteredCatalog.length}
												</span>
											)}
										</div>
									</div>

									<div className="max-h-[320px] overflow-y-auto p-1.5 space-y-2">
										{filteredCatalog.length === 0 ? (
											<div className="flex flex-col items-center justify-center py-8 px-4 text-center">
												<div className="size-10 rounded-full bg-muted/70 flex items-center justify-center text-muted-foreground mb-2.5">
													<SearchX className="size-5" />
												</div>
												<p className="text-xs font-semibold text-foreground mb-1">
													{modelCatalog.length === 0
														? t('shell.composer.loadingModels', {
																defaultValue: '正在加载模型…'
															})
														: t('shell.composer.noModelMatch', {
																defaultValue: '未找到匹配的模型'
															})}
												</p>
												<p className="text-[11px] text-muted-foreground max-w-[240px] mb-3 leading-relaxed">
													{t('shell.composer.noModelHint', {
														defaultValue: '尝试使用其他关键词，或前往设置配置新模型'
													})}
												</p>
												<button
													type="button"
													onClick={() => {
														setModelPopOpen(false);
														window.dispatchEvent(
															new CustomEvent('fast-ide:open-settings', {
																detail: {section: 'models'}
															})
														);
													}}
													className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/80 bg-background hover:bg-muted text-xs font-medium text-foreground transition-all shadow-xs cursor-pointer"
												>
													<Settings className="size-3.5 text-muted-foreground" />
													<span>
														{t('shell.composer.manageModels', {
															defaultValue: '配置模型与提供商'
														})}
													</span>
												</button>
											</div>
										) : (
											groupedCatalog.map(group => {
												const brand = getProviderBrand(group.providerKey);
												return (
													<div key={group.providerKey} className="space-y-1">
														<div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
															<div className="flex items-center gap-1.5 min-w-0">
																<span
																	className={cn(
																		'size-4 rounded text-[9.5px] font-bold flex items-center justify-center shrink-0 shadow-2xs',
																		brand.iconBg
																	)}
																>
																	{brand.shortName}
																</span>
																<span className="truncate">{group.providerLabel}</span>
															</div>
															<span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-muted/60 text-muted-foreground font-normal">
																{t('shell.composer.modelCountSimple', {
																	count: group.items.length,
																	defaultValue: `${group.items.length} 个模型`
																})}
															</span>
														</div>

														<div className="space-y-0.5">
															{group.items.map(({entry, cleanName}) => {
																const isSelected = matchCatalogEntry(entry, effectiveModel);
																const badges = getModelCapabilityBadges(entry, cleanName);

																return (
																	<button
																		key={entry.id}
																		type="button"
																		onClick={() => void pickModel(entry.id)}
																		className={cn(
																			'group relative w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all duration-150 cursor-pointer border',
																			isSelected
																				? 'bg-primary/10 border-primary/25 text-primary shadow-2xs'
																				: 'border-transparent hover:bg-muted/70 hover:border-border/50 text-foreground'
																		)}
																	>
																		<div className="min-w-0 flex-1 flex items-start gap-2.5">
																			<div
																				className={cn(
																					'mt-0.5 size-7 rounded-lg flex items-center justify-center shrink-0 transition-colors border',
																					isSelected
																						? 'bg-primary/15 border-primary/30 text-primary'
																						: 'bg-muted/50 border-border/40 text-muted-foreground group-hover:text-foreground group-hover:bg-muted'
																				)}
																			>
																				{badges.some(b => b.key === 'thinking') ? (
																					<BrainCircuit className="size-3.5" />
																				) : badges.some(b => b.key === 'fast') ? (
																					<Zap className="size-3.5" />
																				) : (
																					<Sparkles className="size-3.5" />
																				)}
																			</div>

																			<div className="min-w-0 flex-1 space-y-0.5">
																				<div className="flex items-center gap-1.5">
																					<span
																						className={cn(
																							'text-xs font-semibold truncate',
																							isSelected
																								? 'text-primary font-bold'
																								: 'text-foreground group-hover:text-primary transition-colors'
																						)}
																					>
																						{cleanName}
																					</span>
																				</div>

																				<div className="flex items-center gap-1.5 flex-wrap">
																					<span
																						className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-[170px]"
																						title={entry.id}
																					>
																						{entry.id}
																					</span>
																					{badges.map(b => (
																						<span
																							key={b.key}
																							className={cn(
																								'text-[9.5px] px-1.5 py-0.2 rounded border font-medium leading-none',
																								b.className
																							)}
																						>
																							{b.label}
																						</span>
																					))}
																				</div>
																			</div>
																		</div>

																		<div className="shrink-0 flex items-center gap-1">
																			{isSelected ? (
																				<div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-medium shadow-xs animate-in fade-in-50 zoom-in-95">
																					<Check className="size-3 stroke-[2.5]" />
																					<span>
																						{t('shell.composer.currentModel', {
																							defaultValue: '当前'
																						})}
																					</span>
																				</div>
																			) : (
																				<ChevronRight className="size-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
																			)}
																		</div>
																	</button>
																);
															})}
														</div>
													</div>
												);
											})
										)}
									</div>

									<div className="flex items-center justify-between px-3.5 py-2 bg-muted/40 dark:bg-muted/20 border-t border-border/60 text-xs">
										<span className="text-[11px] text-muted-foreground flex items-center gap-1.5 font-medium">
											<Layers className="size-3 text-muted-foreground/70" />
											{t('shell.composer.modelCount', {
												count: modelCatalog.length,
												defaultValue: `共 ${modelCatalog.length} 个可用模型`
											})}
										</span>
										<button
											type="button"
											onClick={() => {
												setModelPopOpen(false);
												window.dispatchEvent(
													new CustomEvent('fast-ide:open-settings', {
														detail: {section: 'models'}
													})
												);
											}}
											className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer group"
										>
											<Settings className="size-3 text-muted-foreground group-hover:text-foreground transition-colors" />
											<span>
												{t('shell.composer.manageModels', {
													defaultValue: '配置模型与提供商'
												})}
											</span>
											<ArrowUpRight className="size-3 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
										</button>
									</div>
								</PopoverContent>
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
									<PopoverContent
										className="w-72 p-0 shadow-2xl border border-border/80 rounded-2xl overflow-hidden bg-popover/98 backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-150 flex flex-col"
										align="start"
										sideOffset={8}
									>
										{supportsThinking && (
											<div className="p-3 border-b border-border/60 bg-muted/30 dark:bg-muted/15">
												<div className="flex items-center justify-between gap-3">
													<div className="flex items-center gap-2 min-w-0">
														<BrainCircuit
															className={cn(
																'size-4 shrink-0 transition-colors',
																thinking ? 'text-primary' : 'text-muted-foreground'
															)}
														/>
														<div className="min-w-0">
															<div className="text-xs font-semibold text-foreground">
																{t('shell.composer.thinkingDeep', {defaultValue: '深度思考'})}
															</div>
															<div className="text-[10.5px] text-muted-foreground truncate">
																{t('shell.composer.thinkingDesc', {
																	defaultValue: '生成回答前进行扩展思考'
																})}
															</div>
														</div>
													</div>
													<div className="inline-flex h-7 items-center rounded-lg border border-border/60 bg-background/80 dark:bg-background/40 p-0.5 shadow-2xs shrink-0">
														<button
															type="button"
															onClick={() => void toggleThinking(true)}
															className={cn(
																'h-full rounded-[6px] px-2 text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1',
																thinking
																	? 'bg-primary text-primary-foreground shadow-xs font-semibold'
																	: 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
															)}
														>
															{t('shell.composer.thinkingOn', {defaultValue: '开启'})}
														</button>
														<button
															type="button"
															onClick={() => void toggleThinking(false)}
															className={cn(
																'h-full rounded-[6px] px-2 text-[11px] font-medium transition-all cursor-pointer',
																!thinking
																	? 'bg-muted text-foreground font-semibold shadow-2xs'
																	: 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
															)}
														>
															{t('shell.composer.thinkingOff', {defaultValue: '关闭'})}
														</button>
													</div>
												</div>
											</div>
										)}

										{supportedEfforts.length > 0 && (
											<div className="p-2 space-y-1">
												<div className="px-2 pt-1 pb-1 flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
													<span className="flex items-center gap-1.5">
														<SlidersHorizontal className="size-3" />
														{t('shell.composer.effortLevel', {defaultValue: '思考力度'})}
													</span>
													{!thinking && (
														<span className="text-[10px] text-muted-foreground/70 font-normal">
															{t('shell.composer.thinkingDisabledHint', {
																defaultValue: '开启后生效'
															})}
														</span>
													)}
												</div>

												<div className="space-y-1">
													{supportedEfforts.map(e => {
														const isSelected = effort === e;
														return (
															<button
																key={e}
																type="button"
																disabled={!thinking}
																onClick={() => {
																	void pickEffort(e);
																}}
																className={cn(
																	'group w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all duration-150 border',
																	!thinking
																		? 'opacity-40 cursor-not-allowed border-transparent'
																		: isSelected
																			? 'bg-primary/10 border-primary/25 text-primary shadow-2xs cursor-pointer'
																			: 'border-transparent hover:bg-muted/70 hover:border-border/50 text-foreground cursor-pointer'
																)}
															>
																<div className="min-w-0 flex-1">
																	<div className="flex items-center gap-1.5">
																		<span
																			className={cn(
																				'text-xs font-semibold',
																				isSelected && thinking ? 'text-primary font-bold' : 'text-foreground'
																			)}
																		>
																			{EFFORT_LABEL[e] ?? e}
																		</span>
																	</div>
																	<p className="text-[10.5px] text-muted-foreground truncate leading-tight mt-0.5">
																		{getEffortDesc(e)}
																	</p>
																</div>

																{isSelected && thinking && (
																	<div className="size-5 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
																		<Check className="size-3 stroke-[2.5]" />
																	</div>
																)}
															</button>
														);
													})}
												</div>
											</div>
										)}
									</PopoverContent>
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
