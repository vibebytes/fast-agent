import type {ConfigurableTool} from '@fast-ide/session-view';

export type ToolGroupKey = 'general' | 'image' | 'video' | 'speech' | 'other';

export const TOOL_GROUP_KEYS: readonly ToolGroupKey[] = ['general', 'image', 'video', 'speech', 'other'];

/** Tab order is fixed; an empty group keeps its tab with an empty state. */
export function groupForTool(tool: ConfigurableTool): ToolGroupKey {
	if (TOOL_GROUP_KEYS.includes(tool.group as ToolGroupKey)) return tool.group as ToolGroupKey;
	if (/search|web/.test(tool.name)) return 'general';
	if (/image|draw|paint/.test(tool.name)) return 'image';
	if (/video|caption/.test(tool.name)) return 'video';
	if (/tts|asr|speech|voice|transcri/.test(tool.name)) return 'speech';
	return 'other';
}

export type ToolGroupRow = {key: ToolGroupKey; tools: ConfigurableTool[]};

export function groupRows(tools: readonly ConfigurableTool[]): ToolGroupRow[] {
	return TOOL_GROUP_KEYS.map(key => ({key, tools: toolsInGroup(tools, key)}));
}

export function toolsInGroup(tools: readonly ConfigurableTool[], key: ToolGroupKey): ConfigurableTool[] {
	return tools.filter(tool => groupForTool(tool) === key);
}
