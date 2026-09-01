import React from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../contexts/ThemeContext.js';
import {compactPath} from '../utils/textWidth.js';
import {currentTerminalSize} from '../hooks/useTerminalSize.js';
import {isScreenReader} from '../terminal/capabilityManager.js';

const logo = [
	'███████╗  █████╗  ███████╗████████╗',
	'██╔════╝ ██╔══██╗ ██╔════╝╚══██╔══╝',
	'█████╗   ███████║ ╚█████╗    ██║   ',
	'██╔══╝   ██╔══██║  ╚═══██╗   ██║   ',
	'██║      ██║  ██║ ███████║   ██║   ',
	'╚═╝      ╚═╝  ╚═╝ ╚══════╝   ╚═╝   '
];

const tinyLogo = ['F A S T'];

const gradient = ['#7B2CBF', '#483DCF', '#0078D7', '#00B4D8', '#00F5D4'];

function GradientLine({line}: {line: string}) {
	const chars = [...line];
	return (
		<Text>
			{chars.map((char, index) => {
				const color = gradient[Math.floor((index / Math.max(chars.length - 1, 1)) * (gradient.length - 1))];
				return <Text key={`${char}-${index}`} color={color}>{char}</Text>;
			})}
		</Text>
	);
}

/**
 * Startup banner. Printed exactly once into the <Static> region (scrollback),
 * gemini-cli style — it must not depend on live state, which is what the
 * footer is for.
 */
export function AppHeader() {
	const {theme} = useTheme();
	const {columns} = currentTerminalSize();
	// Box-drawing ASCII art is meaningless noise for screen readers.
	const lines = isScreenReader() ? ['FAST'] : columns >= 44 ? logo : tinyLogo;

	return (
		<Box flexDirection="column" marginBottom={1} paddingX={1}>
			<Box flexDirection="column" marginTop={1}>
				{lines.map(line => <GradientLine key={line} line={line} />)}
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text>
					<Text bold>fast-ink</Text>
					<Text color={theme.text.muted}> v0.2.0-SNAPSHOT · {compactPath(process.cwd(), Math.max(20, columns - 28))}</Text>
				</Text>
				<Text color={theme.text.muted}>
					/help 命令列表 · Ctrl+O 展开详情 · /theme 主题 · Shift+Enter 换行
				</Text>
			</Box>
		</Box>
	);
}
