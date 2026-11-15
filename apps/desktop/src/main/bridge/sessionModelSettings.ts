import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
import {
	createCatalogSettings,
	isPlaceholderModelDisplay,
	isUnresolvedModelDisplay,
	type EngineKind
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

	function setAvailableEngines(ids: string[]): void {
		availableIds = new Set(ids);
		if (availableIds.size === 0) availableIds.add('fast');
	}

	function availableEngineIds(): string[] {
		return [...availableIds];
	}

	function healDefaultModelDisplay(model: string, display: string): boolean {
		return catalog.healDefaultModelDisplay(model, display);
	}

	/** ready/hello: never bind the yaml stub or the bare `default` alias as resolved. */
	function applyResolvedModel(
		model: string | undefined,
		modelDisplay: string | undefined,
		targetTask?: TaskRecord | null
	): void {
		if (!model) return;
		const display = modelDisplay ?? model;
		if (isUnresolvedModelDisplay(display) || isPlaceholderModelDisplay(model)) return;
		catalog.applyModel(model, display, targetTask);
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
		setAvailableEngines,
		availableEngineIds,
		healDefaultModelDisplay,
		applyModel: catalog.applyModel,
		applyResolvedModel,
		applyRunMode: catalog.applyRunMode,
		submitThinking: catalog.submitThinking,
		restoreChromeFromTask,
		modelCommandResult
	};
}
