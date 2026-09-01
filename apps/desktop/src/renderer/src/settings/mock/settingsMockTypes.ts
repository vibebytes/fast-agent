export type MockStatus = 'ready' | 'loading' | 'empty' | 'error' | 'disabled';
export type Source = 'Global' | 'Project override' | 'Task temporary';
export type ProviderStatus = 'connected' | 'needs-auth' | 'error';
export type PluginType = 'Skills' | 'MCP' | 'CLI' | 'Extensions';
export type TaskStatus = 'Running' | 'Waiting' | 'Completed' | 'Failed' | 'Archived';

export type AgentExecutionMode = 'ask' | 'auto' | 'plan';
export type AgentPermissionPreset = 'strict' | 'workspace' | 'full';

export type MockAgent = {
	id: string;
	name: string;
	description: string;
	model: string;
	enabled: boolean;
	isDefault: boolean;
};

export type AgentSettings = {
	defaultAgentId: string;
	defaultModelId: string;
	executionMode: AgentExecutionMode;
	permissionPreset: AgentPermissionPreset;
	maxTurns: number;
	parallelAgents: boolean;
	streamResponses: boolean;
	showAgentActivity: boolean;
};

export type MockModel = {
	id: string;
	name: string;
	provider: string;
	capabilities: string[];
	contextWindow: string;
	source: Source;
	isDefault: boolean;
};

export type MockProvider = {
	id: string;
	name: string;
	type: 'API' | 'Coding Plan';
	status: ProviderStatus;
	baseUrl: string;
	maskedCredential?: string;
	modelCount: number;
};

export type MockPlugin = {
	id: string;
	name: string;
	type: PluginType;
	version: string;
	enabled: boolean;
	scope: Source;
	status: 'Ready' | 'Needs setup' | 'Error';
	permissions: string[];
};

export type MockProject = {
	id: string;
	name: string;
	path: string;
	status: 'Ready' | 'Needs attention';
	server: string;
	rules: number;
	modelOverride?: string;
	pluginCount: number;
};

export type MockHealthCheck = {
	id: string;
	label: string;
	status: 'healthy' | 'warning' | 'error';
	message: string;
	fixTarget?: string;
};

export type MockState = {
	agents: MockAgent[];
	models: MockModel[];
	providers: MockProvider[];
	plugins: MockPlugin[];
	projects: MockProject[];
	health: MockHealthCheck[];
	general: {
		restoreWorkspace: boolean;
		notifications: boolean;
		soundPrompt: boolean;
		approvalSound: boolean;
		experimental: boolean;
	};
	agentSettings: AgentSettings;
	defaultModelId: string;
	selectedProjectId: string;
	status: MockStatus;
	lastAction: string | null;
};

export type MockResult = {ok: boolean; message: string};
