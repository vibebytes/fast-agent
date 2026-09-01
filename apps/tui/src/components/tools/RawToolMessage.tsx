import React from 'react';
import {Box, Text} from 'ink';
import type {ToolDisplayModel} from '../../tools/toolMapping.js';
import type {ToolTimelineProps} from './ToolGroupMessage.js';
import {ToolTimelineContinuation, ToolTimelinePrefix, TOOL_HEADER_PREFIX_WIDTH, TOOL_RESULT_PREFIX_WIDTH} from './ToolTimelineRow.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {truncateMiddle} from '../../theme/semanticTheme.js';
import {detectTerminalCapabilities} from '../../terminal/capabilityManager.js';
import {STR} from '../../ui/strings.js';

type Props = {model: ToolDisplayModel; compact?: boolean; timeline?: ToolTimelineProps};

/** Fallback renderer for unknown tools: header line + one elbow summary line. */
export function RawToolMessage({model, compact, timeline}: Props) {
	const {theme} = useTheme();
	const caps = detectTerminalCapabilities();
	const headerPrefixWidth = timeline ? TOOL_HEADER_PREFIX_WIDTH : 0;
	const linePrefixWidth = timeline ? TOOL_RESULT_PREFIX_WIDTH : 0;
	const isFailure = model.status === 'failed' || model.status === 'denied';
	const summary = model.status === 'denied'
		? STR.deniedTag
		: model.summary.replace(/\n/g, ' ').trim();

	return (
		<Box flexDirection="column" marginY={compact || timeline ? 0 : 1} width="100%">
			<Box flexDirection="row" width="100%">
				<Text wrap="truncate">
					{timeline && <ToolTimelinePrefix {...timeline} status={model.status} />}
					<Text color={theme.text.accent}>{model.tool}</Text>
					{model.duration && <Text dimColor> · {model.duration}</Text>}
				</Text>
			</Box>
			{!compact && summary.length > 0 && (
				<Box flexDirection="row" width="100%">
					{timeline && <ToolTimelineContinuation first />}
					<Text
						wrap="truncate"
						color={isFailure ? theme.status.danger : undefined}
						dimColor={!isFailure}
					>
						{truncateMiddle(summary, Math.max(8, caps.width - linePrefixWidth))}
					</Text>
				</Box>
			)}
		</Box>
	);
}
