export const pluginTabOrder = [
	{id: 'skills', hidden: false},
	{id: 'tools', hidden: false},
	{id: 'mcp', hidden: false},
	{id: 'cli', hidden: true},
	{id: 'extensions', hidden: false}
] as const;

export type PluginTabId = (typeof pluginTabOrder)[number]['id'];

/** Tabs the settings page actually shows. CLI stays in the order but hidden. */
export function visiblePluginTabs(): PluginTabId[] {
	return pluginTabOrder.filter(tab => !tab.hidden).map(tab => tab.id);
}
