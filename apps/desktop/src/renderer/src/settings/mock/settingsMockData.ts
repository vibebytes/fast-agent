import type {MockState} from './settingsMockTypes';

export const defaultSettingsMockState: MockState = {
	agents: [
		{id: 'general-coding', name: 'General Coding', description: 'Build features and fix issues in your workspace.', model: 'GPT-5', enabled: true, isDefault: true},
		{id: 'code-review', name: 'Code Review', description: 'Review changes for correctness, quality, and maintainability.', model: 'Claude Sonnet', enabled: true, isDefault: false},
		{id: 'research', name: 'Research Analyst', description: 'Compare sources and summarize findings with evidence.', model: 'GPT-5', enabled: false, isDefault: false}
	],
	models: [
		{id: 'gpt-5', name: 'GPT-5', provider: 'OpenAI', capabilities: ['Tools', 'Vision'], contextWindow: '256k', source: 'Global', isDefault: true},
		{id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'Anthropic', capabilities: ['Tools', 'Vision', 'Streaming'], contextWindow: '200k', source: 'Project override', isDefault: false},
		{id: 'qwen-local', name: 'Qwen Local', provider: 'Ollama', capabilities: ['Tools'], contextWindow: '32k', source: 'Global', isDefault: false}
	],
	providers: [
		{id: 'openai', name: 'OpenAI', type: 'API', status: 'connected', baseUrl: 'https://api.openai.com', maskedCredential: '••••••••sk-42', modelCount: 4},
		{id: 'anthropic', name: 'Anthropic', type: 'API', status: 'needs-auth', baseUrl: 'https://api.anthropic.com', modelCount: 3},
		{id: 'ollama', name: 'Ollama', type: 'API', status: 'connected', baseUrl: 'http://localhost:11434', modelCount: 2}
	],
	plugins: [
		{id: 'git-tools', name: 'Git Tools', type: 'MCP', version: '1.4.0', enabled: true, scope: 'Global', status: 'Ready', permissions: ['Git', 'Network']},
		{id: 'code-review', name: 'Code Review', type: 'Skills', version: '0.8.2', enabled: true, scope: 'Project override', status: 'Ready', permissions: ['Files']},
		{id: 'shell-helper', name: 'Shell Helper', type: 'CLI', version: '2.0.1', enabled: false, scope: 'Global', status: 'Needs setup', permissions: ['Shell']}
	],
	mcpServers: [
		{name: 'filesystem', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'], enabled: true, state: 'running', pid: 48213, discoveredToolCount: 11},
		{name: 'github', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], enabled: true, state: 'starting', restarts: 1, discoveredToolCount: 24},
		{name: 'postgres', transport: 'stdio', command: 'uvx', args: ['mcp-server-postgres', 'postgresql://localhost:5432/app'], enabled: true, state: 'failed', restarts: 3, lastError: 'connection refused: 127.0.0.1:5432', stderrTail: 'error: could not connect to server: Connection refused\n\tIs the server running on host "127.0.0.1" and accepting\n\tTCP/IP connections on port 5432?'},
		{name: 'linear', transport: 'remote', url: 'https://mcp.linear.app/sse', enabled: true, state: 'running', discoveredToolCount: 8, restartRequired: true},
		{name: 'sentry', transport: 'remote', url: 'https://mcp.sentry.dev/sse', enabled: false, state: 'stopped'}
	],
	projects: [
		{id: 'fast-ide', name: 'fast-ide', path: '/workspace/fast-ide', status: 'Ready', server: 'Local machine', rules: 4, modelOverride: 'Claude Sonnet', pluginCount: 6},
		{id: 'demo', name: 'demo-project', path: '/workspace/demo-project', status: 'Needs attention', server: 'dev-server', rules: 2, pluginCount: 2}
	],
	health: [
		{id: 'config', label: 'Application configuration', status: 'healthy', message: 'Configuration is valid.'},
		{id: 'bridge', label: 'Bridge', status: 'healthy', message: 'Bridge is ready.'},
		{id: 'engine', label: 'Engine', status: 'healthy', message: 'Engine is connected.'},
		{id: 'provider', label: 'Provider authentication', status: 'warning', message: 'Anthropic credentials need attention.', fixTarget: 'providers'},
		{id: 'model', label: 'Model capabilities', status: 'error', message: 'The selected model does not support tool calling.', fixTarget: 'models'}
	],
	general: {
		restoreWorkspace: true,
		notifications: true,
		soundPrompt: true,
		approvalSound: true,
		experimental: false
	},
	agentSettings: {defaultAgentId: 'general-coding', defaultModelId: 'gpt-5', executionMode: 'ask', permissionPreset: 'workspace', maxTurns: 20, parallelAgents: true, streamResponses: true, showAgentActivity: true},
	defaultModelId: 'gpt-5',
	selectedProjectId: 'fast-ide',
	status: 'ready',
	lastAction: null
};
