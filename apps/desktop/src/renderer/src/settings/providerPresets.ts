/** Add-service card templates — mirrors Engine ProviderPresets (UI-only; seeds live server-side). */

export type PresetCard = {
	presetKey: string;
	displayName: string;
	kind: 'api' | 'oauth' | 'coding_plan' | 'aggregator' | 'local';
	baseUrl: string;
	/** Official / OpenRouter: key only. Custom: name + url + key + seed models. */
	form: 'official' | 'openrouter' | 'custom' | 'shell';
	comingSoon?: boolean;
};

export type PresetGroup = {
	id: 'oauth' | 'official' | 'aggregator' | 'coding_plan' | 'local';
	presets: PresetCard[];
};

export const PRESET_GROUPS: PresetGroup[] = [
	{
		id: 'official',
		presets: [
			{presetKey: 'anthropic', displayName: 'Anthropic', kind: 'api', baseUrl: 'https://api.anthropic.com', form: 'official'},
			{presetKey: 'openai', displayName: 'OpenAI', kind: 'api', baseUrl: 'https://api.openai.com/v1', form: 'official'},
			{presetKey: 'deepseek', displayName: 'DeepSeek', kind: 'api', baseUrl: 'https://api.deepseek.com/v1', form: 'official'},
			{presetKey: 'moonshot', displayName: 'Moonshot', kind: 'api', baseUrl: 'https://api.moonshot.cn/v1', form: 'official'},
			{presetKey: 'zhipu', displayName: '智谱 GLM', kind: 'api', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', form: 'official'},
			{presetKey: 'volcesArk', displayName: '火山方舟', kind: 'api', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', form: 'official'}
		]
	},
	{
		id: 'aggregator',
		presets: [
			{presetKey: 'openrouter', displayName: 'OpenRouter', kind: 'aggregator', baseUrl: 'https://openrouter.ai/api/v1', form: 'openrouter'}
		]
	},
	{
		id: 'oauth',
		presets: [
			{presetKey: 'openai-oauth', displayName: 'OpenAI · ChatGPT', kind: 'oauth', baseUrl: '', form: 'shell', comingSoon: true},
			{presetKey: 'claude-oauth', displayName: 'Claude · Pro', kind: 'oauth', baseUrl: '', form: 'shell', comingSoon: true},
			{presetKey: 'xai-oauth', displayName: 'xAI Grok', kind: 'oauth', baseUrl: '', form: 'shell', comingSoon: true}
		]
	},
	{
		id: 'coding_plan',
		presets: [
			{presetKey: 'glm-plan', displayName: 'GLM Plan', kind: 'coding_plan', baseUrl: '', form: 'shell', comingSoon: true},
			{presetKey: 'kimi-plan', displayName: 'Kimi Plan', kind: 'coding_plan', baseUrl: '', form: 'shell', comingSoon: true}
		]
	},
	{
		id: 'local',
		presets: [
			{presetKey: 'ollama', displayName: 'Ollama', kind: 'local', baseUrl: 'http://127.0.0.1:11434', form: 'shell', comingSoon: true},
			/** UI-only entry: form picks protocol; submit maps to custom-openai / custom-anthropic. */
			{presetKey: 'custom', displayName: '+', kind: 'api', baseUrl: '', form: 'custom'}
		]
	}
];

/** Wire protocol → Engine preset (meta.protocol is the real dialect). */
export function customPresetKey(protocol: 'openai-compat' | 'anthropic'): string {
	return protocol === 'anthropic' ? 'custom-anthropic' : 'custom-openai';
}

export function presetByKey(key: string): PresetCard | undefined {
	return PRESET_GROUPS.flatMap(g => g.presets).find(p => p.presetKey === key);
}

/** Vendor badge from modelId prefix on aggregator platforms (first path segment). */
export function vendorHint(modelId: string, isAggregator: boolean): string | null {
	if (!isAggregator) return null;
	const slash = modelId.indexOf('/');
	if (slash <= 0) return null;
	return modelId.slice(0, slash);
}

export function modelSourceOf(meta: unknown): string {
	if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return 'catalog';
	const src = (meta as {modelSource?: unknown}).modelSource;
	return typeof src === 'string' && src.trim() ? src.trim() : 'catalog';
}

export function statusLabelKey(status: string | null | undefined): string {
	switch ((status ?? 'untested').toLowerCase()) {
		case 'ok':
			return 'ok';
		case 'auth_failed':
			return 'authFailed';
		case 'unreachable':
			return 'unreachable';
		default:
			return 'untested';
	}
}
