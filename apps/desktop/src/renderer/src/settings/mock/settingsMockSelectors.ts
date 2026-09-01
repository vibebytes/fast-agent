import type {MockState, Source} from './settingsMockTypes';

export function selectDefaultModel(state: MockState) {
	return state.models.find(model => model.id === state.defaultModelId) ?? null;
}

export function selectProject(state: MockState) {
	return state.projects.find(project => project.id === state.selectedProjectId) ?? null;
}

export function selectModelsByProvider(state: MockState, provider: string) {
	return provider === 'All' ? state.models : state.models.filter(model => model.provider === provider);
}

export function selectBySource<T extends {source?: Source; scope?: Source}>(items: T[], source: Source) {
	return items.filter(item => (item.source ?? item.scope) === source);
}
