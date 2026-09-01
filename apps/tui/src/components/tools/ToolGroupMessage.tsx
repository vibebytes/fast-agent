import React from 'react';
import {Box, Text} from 'ink';
import type {ToolRun} from '../../state/model.js';
import {groupToolsByTurn} from '../../tools/toolMapping.js';
import {DenseToolMessage} from './DenseToolMessage.js';
import {ShellToolMessage} from './ShellToolMessage.js';
import {FileToolMessage} from './FileToolMessage.js';
import {DiffToolMessage} from './DiffToolMessage.js';
import {RawToolMessage} from './RawToolMessage.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useTerminalSize} from '../../hooks/useTerminalSize.js';
import {fitTerminalLine} from '../../theme/semanticTheme.js';
import {STR} from '../../ui/strings.js';
import type {ToolDisplayModel} from '../../tools/toolMapping.js';

type Props = {
	tools: ToolRun[];
	expanded?: boolean;
	compact?: boolean;
};

export function ToolGroupMessage({tools, expanded = false, compact = false}: Props) {
	const {theme} = useTheme();
	// useTerminalSize (not a one-shot capability read) so resize re-renders.
	const {columns, rows} = useTerminalSize();
	if (tools.length === 0) return null;

	const models = groupToolsByTurn(tools, expanded);
	const inspectionSummary = !expanded ? summarizeInspectionTools(models) : undefined;
	const baseModels = inspectionSummary ? models.filter(model => !isSummarizedInspectionTool(model)) : models;
	const activitySummary = !expanded ? summarizeToolActivity(models, baseModels, compact) : undefined;
	const visibleModels = !expanded && compact
		? []
		: !expanded && baseModels.length > 3
			? baseModels.filter(model => model.status !== 'success')
			: baseModels;
	const maxLines = perToolLineBudget(rows, visibleModels.length, visibleModels.filter(m => m.output.length > 0).length, expanded, compact);

	const summaryLines: string[] = [];
	if (activitySummary) summaryLines.push(activitySummary);
	if (inspectionSummary) summaryLines.push(inspectionSummary);

	const summaryText = compact ? summaryLines.join(' · ') : undefined;

	// Use a single unified text expression to prevent Ink's unmounting/mounting line-clearing bugs
	const displayText = compact && summaryText
		? `${summaryText}${STR.expandSuffix}`
		: !compact && activitySummary
			? `${activitySummary}${STR.expandSuffix}`
			: !compact && inspectionSummary
				? `${inspectionSummary}${STR.expandSuffix}`
				: undefined;

	const summaryWidth = Math.max(20, columns - 2);
	const fixedDisplayText = displayText ? fitTerminalLine(displayText, summaryWidth) : undefined;

	return (
		<Box flexDirection="column" marginTop={compact ? 0 : 1} marginBottom={compact ? 0 : 1} width="100%">
		{fixedDisplayText && (
			<Box
				sticky="top"
				opaque
				flexDirection="row"
				width="100%"
				stickyChildren={<Text wrap="truncate" dimColor color={theme.text.muted}>{fixedDisplayText}</Text>}
			>
				<Text wrap="truncate" dimColor color={theme.text.muted}>{fixedDisplayText}</Text>
			</Box>
		)}
			{visibleModels.map((model, index) => {
				const timeline = {
					isFirst: index === 0,
					isLast: index === visibleModels.length - 1
				};
				// If the turn is not compact, but this specific tool succeeded and is not running,
				// we can render it as compact within the active turn to save massive vertical space.
				const toolCompact = compact || (model.status === 'success' && !model.expanded);
				// Breathing room between multi-line blocks (claude-code spaces every
				// tool; we only space where it helps): insert a blank row when this
				// tool or its predecessor rendered output lines. Single-line dense
				// tools keep stacking tightly.
				const previous = visibleModels[index - 1];
				const spaced = !compact && index > 0
					&& (model.output.length > 0 || (previous?.output.length ?? 0) > 0);
				const node = (() => {
					switch (model.renderer) {
						case 'shell':
							return <ShellToolMessage model={model} compact={toolCompact} timeline={timeline} maxLines={maxLines} />;
						case 'file':
							return <FileToolMessage model={model} compact={toolCompact} timeline={timeline} maxLines={maxLines} />;
						case 'diff':
							return <DiffToolMessage model={model} compact={toolCompact} timeline={timeline} maxLines={maxLines} />;
						case 'dense':
							// Dense rows are single-line already; the success-auto-compact
							// downgrade would only suppress the glob match list. Pass the
							// real turn-level compact so aggregates stay flat but normal
							// turns keep the list body.
							return <DenseToolMessage model={model} compact={compact} timeline={timeline} />;
						default:
							return <RawToolMessage model={model} compact={toolCompact} timeline={timeline} />;
					}
				})();
				return (
					<Box key={model.id} flexDirection="column" width="100%" marginTop={spaced ? 1 : 0}>
						{node}
					</Box>
				);
			})}
		</Box>
	);
}

function summarizeToolActivity(allModels: ToolDisplayModel[], baseModels: ToolDisplayModel[], compact = false): string | undefined {
	if (!compact && baseModels.length <= 3) return undefined;

	const success = allModels.filter(model => model.status === 'success');
	const running = allModels.filter(model => model.status === 'running');
	const failed = allModels.filter(model => model.status === 'failed' || model.status === 'denied');

	const parts: string[] = [];
	if (success.length > 0) parts.push(STR.toolsDone(success.length));
	if (running.length > 0) parts.push(STR.toolsRunning(running.length));
	if (failed.length > 0) parts.push(STR.toolsFailed(failed.length));

	if (parts.length === 0) return undefined;

	const toolCounts = allModels.reduce<Record<string, number>>((acc, model) => {
		acc[model.tool] = (acc[model.tool] ?? 0) + 1;
		return acc;
	}, {});
	const kinds = Object.entries(toolCounts)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([tool, count]) => `${tool} ×${count}`)
		.join(', ');

	const total = totalDuration(allModels);

	return `工具: ${parts.join(' · ')}${kinds ? ` · ${kinds}` : ''}${total ? ` · 共 ${total}` : ''}`;
}

/** Sum per-tool durations ("64ms", "1.2s") into a compact batch total. */
function totalDuration(models: ToolDisplayModel[]): string | undefined {
	let totalMs = 0;
	let seen = 0;
	for (const model of models) {
		const raw = model.duration?.trim();
		if (!raw) continue;
		const match = /^([\d.]+)\s*(ms|s|m)$/.exec(raw);
		if (!match) continue;
		const value = Number(match[1]);
		if (!Number.isFinite(value)) continue;
		totalMs += match[2] === 'ms' ? value : match[2] === 's' ? value * 1000 : value * 60_000;
		seen += 1;
	}
	if (seen < 2) return undefined; // a "total" of one tool is just noise
	if (totalMs >= 60_000) return `${(totalMs / 60_000).toFixed(1)}m`;
	if (totalMs >= 1000) return `${(totalMs / 1000).toFixed(1)}s`;
	return `${Math.round(totalMs)}ms`;
}

function summarizeInspectionTools(models: ToolDisplayModel[]): string | undefined {
	const files = models.filter(model => model.tool === 'read_file' && model.status === 'success');
	const dirs = models.filter(model => model.tool === 'list_dir' && model.status === 'success');
	if (files.length === 0 && dirs.length === 0) return undefined;

	const parts: string[] = [];
	if (files.length > 0) {
		// Name the files (basenames) so the summary is auditable at a glance —
		// a bare count forces the user to expand just to see what was touched.
		const names = files
			.map(model => basename(model.args.path ?? model.args.file ?? model.fields.path ?? ''))
			.filter(name => name.length > 0);
		const shown = names.slice(0, 3).join(', ');
		const more = names.length > 3 ? ` +${names.length - 3}` : '';
		parts.push(`${STR.readFiles(files.length)}${shown ? `: ${shown}${more}` : ''}`);
	}
	if (dirs.length > 0) {
		parts.push(STR.listedDirs(dirs.length));
	}

	const [first, ...rest] = parts;
	if (!first) return undefined;
	return [first, ...rest].join(' · ');
}

function basename(path: string): string {
	const segments = path.split('/');
	return segments.at(-1) ?? path;
}

function isSummarizedInspectionTool(model: ToolDisplayModel): boolean {
	return (model.tool === 'read_file' || model.tool === 'list_dir') && model.status === 'success';
}

/**
 * Split the available terminal height across the tools that actually produced
 * output, so a single long result can't dominate the whole turn (gemini-cli
 * style), while keeping a tight default for the collapsed view (Claude Code style).
 */
function perToolLineBudget(terminalRows: number, toolCount: number, toolsWithOutput: number, expanded: boolean, compact: boolean): number {
	if (compact) return 2;
	const divisor = Math.max(1, toolsWithOutput);
	// *3: header + first result row + the spacer row between multi-line blocks.
	// +2 per output-bearing tool: shell cards spend two rows on their border.
	const staticReserve = 1 + toolCount * 3 + toolsWithOutput * 2;
	const totalBudget = Math.floor(terminalRows * (expanded ? 0.6 : 0.45));
	const share = Math.floor((totalBudget - staticReserve) / divisor);
	return Math.max(expanded ? 8 : 3, share);
}

export type ToolTimelineProps = {
	isFirst: boolean;
	isLast: boolean;
};
