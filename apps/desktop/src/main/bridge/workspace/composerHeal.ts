import type {ProviderRow} from '@fast-ide/session-view';
import {isPlaceholderModelDisplay, isUnresolvedModelDisplay, matchCatalogEntry} from '@fast-ide/session-view';
import {catalogFromProviders} from '../modelCatalog.js';
import type {SessionController} from '../SessionController.js';
import type {WorkspaceCatalog} from './catalog.js';

type HealHandlers = {onSessionsChanged?: (projectId: string) => void};

export type ComposerHealProject = {
	id: string;
	sessions: SessionController;
};

export type ComposerHeal = {
	refreshComposerCatalog: () => Promise<void>;
	syncComposerCatalog: () => void;
	refreshComposerChrome: (handlers: HealHandlers) => Promise<void>;
};

export function createComposerHeal(deps: {
	catalog: WorkspaceCatalog;
	ready: () => boolean;
	projects: () => Iterable<ComposerHealProject>;
	active: () => ComposerHealProject | null;
}): ComposerHeal {
	let composerCatalogSync: Promise<void> | null = null;

	const chromeNeedsHeal = (sessions: SessionController): boolean => {
		const cat = sessions.modelCatalog;
		const inCatalog =
			cat.length > 0 &&
			cat.some(e => matchCatalogEntry(e, sessions.model) || matchCatalogEntry(e, sessions.modelDisplay));
		if (inCatalog) return false;
		if (isUnresolvedModelDisplay(sessions.modelDisplay) || isPlaceholderModelDisplay(sessions.model)) {
			return true;
		}
		return cat.length > 0;
	};

	const firstEnabledProviderModel = (
		providers: Array<{id: string; enabled: boolean; models?: Array<{modelId: string; displayName?: string; enabled: boolean}>}>
	): {model: string; display: string} | null => {
		for (const p of providers) {
			if (!p.enabled) continue;
			const hit = (p.models ?? []).find(m => m.enabled);
			if (!hit) continue;
			const model = `${p.id}/${hit.modelId}`;
			const display = (hit.displayName || hit.modelId).trim() || model;
			return {model, display};
		}
		return null;
	};

	const loadComposerCatalogFromProviders = async (): Promise<void> => {
		const res = await deps.catalog.listProviders();
		if (!res.ok) return;
		if (res.providers.length > 0) {
			const current = deps.active()?.sessions.model ?? '';
			const catalog = catalogFromProviders(res.providers, current);
			for (const project of deps.projects()) {
				project.sessions.applyProviderCatalog(catalog);
			}
			return;
		}
		for (const project of deps.projects()) {
			project.sessions.requestModelList();
		}
	};

	const syncComposerCatalogFromProviders = (): Promise<void> => {
		if (composerCatalogSync) return composerCatalogSync;
		if (!deps.ready()) return Promise.resolve();
		const run = loadComposerCatalogFromProviders();
		const wrapped = run.finally(() => {
			if (composerCatalogSync === wrapped) composerCatalogSync = null;
		});
		composerCatalogSync = wrapped;
		return wrapped;
	};

	const healDefaultModelChrome = async (handlers: HealHandlers): Promise<void> => {
		const list = [...deps.projects()];
		if (!list.some(p => chromeNeedsHeal(p.sessions))) return;
		if (!list.some(p => p.sessions.modelCatalog.length > 0)) return;

		let model = 'default';
		let display = '';

		const settings = await deps.catalog.getSettings('global');
		if (settings.ok) {
			const doc = settings.settings.find(s => s.namespace === 'models');
			const payload =
				doc?.payload && typeof doc.payload === 'object' ? (doc.payload as Record<string, unknown>) : {};
			const platform = typeof payload.defaultPlatform === 'string' ? payload.defaultPlatform.trim() : '';
			const modelId = typeof payload.defaultModel === 'string' ? payload.defaultModel.trim() : '';
			if (platform && modelId) {
				model = `${platform}/${modelId}`;
				display = `${platform}/${modelId}`;
			}
		}

		if (isUnresolvedModelDisplay(display)) {
			const providers = await deps.catalog.listProviders();
			if (providers.ok) {
				for (const p of providers.providers) {
					if (!p.enabled) continue;
					const hit = (p.models ?? []).find(
						m => m.enabled && (m.aliases ?? []).some(a => a.toLowerCase() === 'default')
					);
					if (!hit) continue;
					model = `${p.id}/${hit.modelId}`;
					display = (hit.displayName || hit.modelId).trim() || `${p.id}/${hit.modelId}`;
					break;
				}
				if (isUnresolvedModelDisplay(display)) {
					const first = firstEnabledProviderModel(providers.providers);
					if (first) {
						model = first.model;
						display = first.display;
					}
				}
			}
		}

		if (isUnresolvedModelDisplay(display)) return;

		let healed = false;
		for (const project of deps.projects()) {
			if (project.sessions.healDefaultModelDisplay(model, display)) healed = true;
		}
		if (!healed) return;
		const active = deps.active();
		if (active) handlers.onSessionsChanged?.(active.id);
		else handlers.onSessionsChanged?.('engine');
	};

	return {
		refreshComposerCatalog: () => syncComposerCatalogFromProviders(),
		syncComposerCatalog: () => {
			void syncComposerCatalogFromProviders();
		},
		async refreshComposerChrome(handlers) {
			await syncComposerCatalogFromProviders();
			await healDefaultModelChrome(handlers);
		}
	};
}

export type {ProviderRow};
