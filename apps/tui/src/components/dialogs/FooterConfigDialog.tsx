import React from 'react';
import {Text} from 'ink';
import type {FooterConfig, FooterItemId} from '../../state/model.js';
import {defaultFooterConfig} from '../../state/model.js';
import {useTheme} from '../../contexts/ThemeContext.js';

const FOOTER_ITEMS: Array<{id: FooterItemId; label: string}> = [
	{id: 'model', label: 'Model name'},
	{id: 'mode', label: 'Input mode'},
	{id: 'cwd', label: 'Working directory'},
	{id: 'trust', label: 'Workspace trust'},
	{id: 'queue', label: 'Queued messages'},
	{id: 'task', label: 'Task / status'},
	{id: 'tokens', label: 'Token usage'},
	{id: 'errors', label: 'Error count'},
	{id: 'admin', label: 'Admin Console URL'}
];

type Props = {
	selected: number;
	config: FooterConfig;
};

export function FooterConfigDialog({selected, config}: Props) {
	const {theme} = useTheme();
	return (
		<>
			{FOOTER_ITEMS.map((item, index) => {
				const enabled = config[item.id] ?? defaultFooterConfig[item.id];
				const marker = index === selected ? '❯ ' : '  ';
				const toggle = enabled ? '[x]' : '[ ]';
				return (
					<Text key={item.id}>
						<Text color={index === selected ? theme.text.accent : undefined}>
							{marker}{toggle} {item.label}
						</Text>
					</Text>
				);
			})}
			<Text dimColor>Enter toggles item • Esc closes</Text>
		</>
	);
}

export {FOOTER_ITEMS};
