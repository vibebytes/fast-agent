import type {ConfigurableTool, PutConfigurableToolInput} from '@fast-ide/session-view';

export function originOf(tool: ConfigurableTool): 'builtin' | 'external' {
	return tool.origin ?? 'builtin';
}

export function originLabelKey(tool: ConfigurableTool): string {
	return originOf(tool) === 'external'
		? 'settings.plugins.tools.origin.external'
		: 'settings.plugins.tools.origin.builtin';
}

export function toolTitle(tool: ConfigurableTool, t: (key: string) => string): string {
	if (tool.titleKey) return t(tool.titleKey);
	return tool.title ?? tool.name;
}

export function toolSummary(tool: ConfigurableTool, t: (key: string) => string): string {
	if (tool.summaryKey) return t(tool.summaryKey);
	return tool.summary ?? '';
}

/** Builtins keep their incoming order. Externals follow, grouped by extension id then name. */
export function byOrigin(tools: readonly ConfigurableTool[]): ConfigurableTool[] {
	return tools
		.map((tool, index) => ({tool, index}))
		.sort((a, b) => {
			const rank = (originOf(a.tool) === 'builtin' ? 0 : 1) - (originOf(b.tool) === 'builtin' ? 0 : 1);
			if (rank !== 0) return rank;
			if (originOf(a.tool) === 'external') {
				const extension = (a.tool.extension ?? '').localeCompare(b.tool.extension ?? '');
				if (extension !== 0) return extension;
				const name = a.tool.name.localeCompare(b.tool.name);
				if (name !== 0) return name;
			}
			return a.index - b.index;
		})
		.map(row => row.tool);
}

export function needsForm(tool: ConfigurableTool): boolean {
	return tool.fields.length > 0;
}

export function toggleSave(tool: ConfigurableTool, enabled: boolean): PutConfigurableToolInput {
	return {name: tool.name, enabled, values: {}, secrets: {}, clearSecrets: []};
}
