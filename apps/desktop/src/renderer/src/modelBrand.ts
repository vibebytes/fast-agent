import type {ModelCatalogEntry} from './env';

export type ProviderBrandInfo = {
	key: string;
	name: string;
	shortName: string;
	iconBg: string;
	dotBg: string;
	badgeClass: string;
	glowBg: string;
};

const PROVIDER_BRANDS: Record<string, Omit<ProviderBrandInfo, 'key'>> = {
	deepseek: {
		name: 'DeepSeek',
		shortName: 'DS',
		iconBg: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30',
		dotBg: 'bg-blue-500',
		badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
		glowBg: 'from-blue-500/10 to-transparent'
	},
	openai: {
		name: 'OpenAI',
		shortName: 'OA',
		iconBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30',
		dotBg: 'bg-emerald-500',
		badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
		glowBg: 'from-emerald-500/10 to-transparent'
	},
	anthropic: {
		name: 'Anthropic',
		shortName: 'CL',
		iconBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30',
		dotBg: 'bg-amber-500',
		badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
		glowBg: 'from-amber-500/10 to-transparent'
	},
	openrouter: {
		name: 'OpenRouter',
		shortName: 'OR',
		iconBg: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30',
		dotBg: 'bg-indigo-500',
		badgeClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
		glowBg: 'from-indigo-500/10 to-transparent'
	},
	zhipu: {
		name: '智谱 GLM',
		shortName: 'GLM',
		iconBg: 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border border-teal-500/30',
		dotBg: 'bg-teal-500',
		badgeClass: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20',
		glowBg: 'from-teal-500/10 to-transparent'
	},
	moonshot: {
		name: 'Moonshot Kimi',
		shortName: 'MS',
		iconBg: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30',
		dotBg: 'bg-purple-500',
		badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
		glowBg: 'from-purple-500/10 to-transparent'
	},
	volces: {
		name: '火山方舟',
		shortName: 'ARK',
		iconBg: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30',
		dotBg: 'bg-orange-500',
		badgeClass: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
		glowBg: 'from-orange-500/10 to-transparent'
	},
	xai: {
		name: 'xAI Grok',
		shortName: 'xAI',
		iconBg: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30',
		dotBg: 'bg-violet-500',
		badgeClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
		glowBg: 'from-violet-500/10 to-transparent'
	},
	google: {
		name: 'Google Gemini',
		shortName: 'G',
		iconBg: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30',
		dotBg: 'bg-sky-500',
		badgeClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
		glowBg: 'from-sky-500/10 to-transparent'
	},
	ollama: {
		name: 'Ollama',
		shortName: 'OL',
		iconBg: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30',
		dotBg: 'bg-cyan-500',
		badgeClass: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
		glowBg: 'from-cyan-500/10 to-transparent'
	},
	qwen: {
		name: '通义千问',
		shortName: 'QW',
		iconBg: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30',
		dotBg: 'bg-purple-500',
		badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
		glowBg: 'from-purple-500/10 to-transparent'
	},
	siliconflow: {
		name: '硅基流动',
		shortName: 'SF',
		iconBg: 'bg-blue-600/15 text-blue-700 dark:text-blue-300 border border-blue-600/30',
		dotBg: 'bg-blue-600',
		badgeClass: 'bg-blue-600/10 text-blue-700 dark:text-blue-300 border-blue-600/20',
		glowBg: 'from-blue-600/10 to-transparent'
	}
};

export function getProviderBrand(providerKeyOrId: string, customName?: string): ProviderBrandInfo {
	const lower = `${providerKeyOrId} ${customName || ''}`.toLowerCase().trim();

	if (lower.includes('deepseek')) return {key: 'deepseek', ...PROVIDER_BRANDS.deepseek};
	if (lower.includes('anthropic') || lower.includes('claude')) return {key: 'anthropic', ...PROVIDER_BRANDS.anthropic};
	if (lower.includes('openai') || lower.includes('chatgpt') || lower.includes('gpt'))
		return {key: 'openai', ...PROVIDER_BRANDS.openai};
	if (lower.includes('openrouter')) return {key: 'openrouter', ...PROVIDER_BRANDS.openrouter};
	if (lower.includes('zhipu') || lower.includes('glm')) return {key: 'zhipu', ...PROVIDER_BRANDS.zhipu};
	if (lower.includes('moonshot') || lower.includes('kimi')) return {key: 'moonshot', ...PROVIDER_BRANDS.moonshot};
	if (lower.includes('volces') || lower.includes('volcengine') || lower.includes('ark'))
		return {key: 'volces', ...PROVIDER_BRANDS.volces};
	if (lower.includes('xai') || lower.includes('grok') || lower.includes('spacexai'))
		return {key: 'xai', ...PROVIDER_BRANDS.xai};
	if (lower.includes('google') || lower.includes('gemini')) return {key: 'google', ...PROVIDER_BRANDS.google};
	if (lower.includes('ollama') || lower.includes('local')) return {key: 'ollama', ...PROVIDER_BRANDS.ollama};
	if (lower.includes('qwen') || lower.includes('dashscope') || lower.includes('alibaba'))
		return {key: 'qwen', ...PROVIDER_BRANDS.qwen};
	if (lower.includes('siliconflow') || lower.includes('silicon'))
		return {key: 'siliconflow', ...PROVIDER_BRANDS.siliconflow};

	const fallbackName =
		customName ||
		(providerKeyOrId && providerKeyOrId !== 'default'
			? providerKeyOrId.charAt(0).toUpperCase() + providerKeyOrId.slice(1)
			: 'AI Model');
	const fallbackInitial = fallbackName.slice(0, 2).toUpperCase() || 'AI';

	return {
		key: providerKeyOrId || 'default',
		name: fallbackName,
		shortName: fallbackInitial,
		iconBg: 'bg-muted/70 text-muted-foreground border border-border/60',
		dotBg: 'bg-muted-foreground',
		badgeClass: 'bg-muted/50 text-muted-foreground border-border/40',
		glowBg: 'from-muted/20 to-transparent'
	};
}

export type ModelCapabilityBadge = {
	key: 'thinking' | 'fast' | 'flagship' | 'code' | 'vision';
	label: string;
	className: string;
};

export function getModelCapabilityBadges(
	entry: ModelCatalogEntry,
	cleanName?: string
): ModelCapabilityBadge[] {
	const badges: ModelCapabilityBadge[] = [];
	const lower = `${entry.id} ${entry.display || ''} ${cleanName || ''}`.toLowerCase();

	if (
		entry.supportsThinking ||
		lower.includes('thinking') ||
		lower.includes('reason') ||
		lower.includes('o1') ||
		lower.includes('o3') ||
		lower.includes('r1')
	) {
		badges.push({
			key: 'thinking',
			label: '思考',
			className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
		});
	}

	if (
		lower.includes('flash') ||
		lower.includes('haiku') ||
		lower.includes('mini') ||
		lower.includes('fast') ||
		lower.includes('turbo') ||
		lower.includes('lite')
	) {
		badges.push({
			key: 'fast',
			label: '极速',
			className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
		});
	} else if (
		lower.includes('pro') ||
		lower.includes('max') ||
		lower.includes('opus') ||
		lower.includes('plus') ||
		lower.includes('terra') ||
		lower.includes('ultra')
	) {
		badges.push({
			key: 'flagship',
			label: '旗舰',
			className: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
		});
	}

	if (lower.includes('code') || lower.includes('coder') || lower.includes('dev')) {
		badges.push({
			key: 'code',
			label: '代码',
			className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
		});
	}

	if (lower.includes('vision') || lower.includes('vl') || lower.includes('multimodal')) {
		badges.push({
			key: 'vision',
			label: '多模态',
			className: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20'
		});
	}

	return badges;
}
