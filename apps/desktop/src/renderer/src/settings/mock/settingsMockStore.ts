import {defaultSettingsMockState} from './settingsMockData';
import type {MockResult, MockState} from './settingsMockTypes';

function cloneState(): MockState {
	return structuredClone(defaultSettingsMockState);
}

export class SettingsMockStore {
	private state = cloneState();
	private listeners = new Set<() => void>();

	getSnapshot = () => this.state;

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	private publish() {
		for (const listener of this.listeners) listener();
	}

	private async commit(mutator: (state: MockState) => void, message: string): Promise<void> {
		this.state = {...this.state, status: 'loading'};
		this.publish();
		await Promise.resolve();
		const next = {...this.state};
		mutator(next);
		this.state = {...next, status: 'ready', lastAction: message};
		this.publish();
	}

	updateGeneral = (patch: Partial<MockState['general']>) => this.commit(state => {
		state.general = {...state.general, ...patch};
	}, 'General settings updated');

	setDefaultModel = (modelId: string) => this.commit(state => {
		state.defaultModelId = modelId;
		state.models = state.models.map(model => ({...model, isDefault: model.id === modelId}));
	}, 'Default model updated');

	setDefaultAgent = (agentId: string) => this.commit(state => {
		state.agents = state.agents.map(agent => ({...agent, isDefault: agent.id === agentId}));
	}, 'Default agent updated');

	toggleAgent = (agentId: string, enabled: boolean) => this.commit(state => {
		state.agents = state.agents.map(agent => agent.id === agentId ? {...agent, enabled} : agent);
	}, 'Agent state updated');

	updateAgentSettings = (patch: Partial<MockState['agentSettings']>) => this.commit(state => {
		state.agentSettings = {...state.agentSettings, ...patch};
	}, 'Agent settings updated');

	togglePlugin = (pluginId: string, enabled: boolean) => this.commit(state => {
		state.plugins = state.plugins.map(plugin => plugin.id === pluginId ? {...plugin, enabled} : plugin);
	}, 'Plugin state updated');

	selectProject = (projectId: string) => this.commit(state => {
		state.selectedProjectId = projectId;
	}, 'Project selected');

	testProvider = async (providerId: string): Promise<MockResult> => {
		await this.commit(state => {
			state.providers = state.providers.map(provider => provider.id === providerId ? {...provider, status: provider.id === 'anthropic' ? 'error' : 'connected'} : provider);
		}, 'Provider connection tested');
		return {ok: providerId !== 'anthropic', message: providerId === 'anthropic' ? 'Authentication failed.' : 'Connection successful.'};
	};

	runHealthChecks = async (): Promise<MockResult> => {
		await this.commit(() => undefined, 'Health checks completed');
		return {ok: true, message: 'Health checks completed.'};
	};

	reset = () => {
		this.state = cloneState();
		this.publish();
	};
}

export const settingsMockStore = new SettingsMockStore();
