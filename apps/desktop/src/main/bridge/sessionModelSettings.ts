import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {
	createCatalogSettings,
	isPlaceholderModelDisplay,
	isUnresolvedModelDisplay,
	parseEngineKind,
	type EngineKind,
	type RunMode
} from '@fast-ide/session-view';
import {parseModelCatalog, type ModelCatalogEntry} from './modelCatalog.js';
import type {TaskRecord} from './sessionContracts.js';

export interface SessionModelSettingsDeps {
	getActiveTask: () => TaskRecord | null;
	tasks: Map<string, TaskRecord>;
	onChange: () => void;
	send: (command: BridgeCommand) => boolean;
	commandSessionId: () => string | undefined;
	sendPinnedCommand: (name: string, args: string, sessionId: string) => boolean;
	stageEngineChange: (sessionId: string, current: EngineKind) => void;
}

/**
 * K17: sticky Composer chrome (model / runMode / engineKind / effort / thinking)
 * + provider catalog, delegated to session-view catalogSettings. Controller keeps
 * getters and one-line forwards only.
 */
export function createSessionModelSettings(deps: SessionModelSettingsDeps) {
	const catalog = createCatalogSettings<TaskRecord>({
		getActiveTask: deps.getActiveTask,
		tasks: deps.tasks,
		onChange: deps.onChange
	});

	// Engine choices offered in the picker; `fast` is always available.
	let availableIds = new Set<string>(['fast']);

	/** Silent `/model` dump — pinned so it never needs a focused task. */
	function requestModelList(): boolean {
		return catalog.requestModelList(deps.commandSessionId(), sessionId =>
			deps.sendPinnedCommand('model', '', sessionId)
		);
	}

	/** Replace Composer catalog with Settings enabled models (not Engine /model yaml). */
	function applyProviderCatalog(entries: ModelCatalogEntry[]): void {
		catalog.applyProviderCatalog(entries);
	}

	function selectModel(modelId: string): boolean {
		const pick = catalog.selectModel(modelId);
		if (!pick) return false;
		const sessionId = deps.commandSessionId();
		if (sessionId) deps.sendPinnedCommand('model', pick.resolvedId, sessionId);
		return true;
	}

	/** Sticky RunMode via Bridge SetMode (agent/plan/ask/yolo). */
	function setRunMode(mode: string, expectedTaskId?: string | null): boolean {
		const active = deps.getActiveTask();
		if (expectedTaskId && active?.id !== expectedTaskId && active?.sessionId !== expectedTaskId) {
			return false;
		}
		const m = mode.trim().toLowerCase();
		if (!['agent', 'plan', 'ask', 'yolo'].includes(m)) return false;
		const sessionId = deps.commandSessionId();
		if (sessionId) deps.send({type: 'SetMode', sessionId, mode: m});
		catalog.applyRunMode(m as TaskRecord['runMode']);
		return true;
	}

	function setAvailableEngines(ids: string[]): void {
		availableIds = new Set(ids);
		if (availableIds.size === 0) availableIds.add('fast');
	}

	function availableEngineIds(): string[] {
		return [...availableIds];
	}

	function setEngineKind(kind: string, expectedTaskId?: string | null): boolean {
		const k = parseEngineKind(kind);
		if (!k) return false;
		if (expectedTaskId) {
			const active = deps.getActiveTask();
			if (active?.id !== expectedTaskId && active?.sessionId !== expectedTaskId) return false;
		}
		const sessionId = deps.commandSessionId();
		if (!sessionId || catalog.engineKind === k) {
			catalog.applyEngineKind(k);
			return Boolean(sessionId);
		}
		deps.stageEngineChange(sessionId, catalog.engineKind);
		return true;
	}

	function setModelSettings(settings: {platform: string; model: string; effort?: string; thinking?: boolean}): boolean {
		const sessionId = deps.commandSessionId();
		if (!sessionId) return false;
		return deps.send({
			type: 'SetModelSettings',
			sessionId,
			platform: settings.platform,
			model: settings.model,
			effort: settings.effort,
			thinking: settings.thinking
		});
	}

	function healDefaultModelDisplay(model: string, display: string): boolean {
		return catalog.healDefaultModelDisplay(model, display);
	}

	function applyModel(model: string, modelDisplay: string): void {
		catalog.applyModel(model, modelDisplay);
	}

	/** ready/hello: never bind the yaml stub or the bare `default` alias as resolved. */
	function applyResolvedModel(model: string | undefined, modelDisplay: string | undefined): void {
		if (!model) return;
		const display = modelDisplay ?? model;
		if (isUnresolvedModelDisplay(display) || isPlaceholderModelDisplay(model)) return;
		catalog.applyModel(model, display);
	}

	function applyRunMode(mode: RunMode): void {
		catalog.applyRunMode(mode);
	}

	/** Match Composer chrome: supportsThinking models default thinking On when sticky unset. */
	function submitThinking(): boolean | undefined {
		return catalog.submitThinking();
	}

	function restoreChromeFromTask(task: TaskRecord): void {
		catalog.syncFromTask(task);
	}

	/** command_result name=model: Hub ListProviders path wins; bare engine dump only when awaiting. */
	function modelCommandResult(event: Extract<BridgeEvent, {type: 'command_result'}>): boolean {
		if (catalog.catalogFromProviders) {
			catalog.clearAwaitingModelList();
			return true;
		}
		if (catalog.awaitingModelList && event.status !== 'error') {
			const current = catalog.takeEngineModelList(parseModelCatalog(event.message));
			if (current) {
				// Prefer catalog display over alias placeholders ("default" / "Default").
				catalog.applyModel(current.id, current.display);
			}
			deps.onChange();
			// Do not project list dump into transcript
			return true;
		}
		catalog.clearAwaitingModelList();
		return false;
	}

	return {
		catalog,
		requestModelList,
		applyProviderCatalog,
		selectModel,
		setRunMode,
		setAvailableEngines,
		availableEngineIds,
		setEngineKind,
		setModelSettings,
		healDefaultModelDisplay,
		applyModel,
		applyResolvedModel,
		applyRunMode,
		submitThinking,
		restoreChromeFromTask,
		modelCommandResult
	};
}
