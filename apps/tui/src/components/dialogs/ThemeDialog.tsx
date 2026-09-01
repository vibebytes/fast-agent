import React from 'react';
import {Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import type {ThemeName} from '../../theme/semanticTheme.js';
import {getThemeNames, resolveTheme} from '../../theme/semanticTheme.js';

type Props = {
	selected: number;
	currentTheme: ThemeName;
};

export function ThemeDialog({selected, currentTheme}: Props) {
	const {theme} = useTheme();
	const names = getThemeNames();
	return (
		<>
			{names.map((name, index) => {
				const preview = resolveTheme(name);
				return (
					<Text key={name}>
						<Text color={index === selected ? theme.text.accent : undefined}>
							{index === selected ? '❯ ' : '  '}{name.padEnd(18)}
						</Text>
						<Text color={preview.text.accent}>● </Text>
						<Text color={preview.status.success}>● </Text>
						<Text color={preview.status.warning}>● </Text>
						<Text color={preview.status.danger}>● </Text>
						<Text color={preview.status.info}>●</Text>
						<Text dimColor>{name === currentTheme ? '  (current)' : ''}</Text>
					</Text>
				);
			})}
			<Text dimColor>Enter 应用主题 · Esc 关闭 · 自定义主题放 ~/.fast/themes/*.json</Text>
		</>
	);
}
