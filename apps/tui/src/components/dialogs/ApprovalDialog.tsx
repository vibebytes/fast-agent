import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {Approval} from '../../state/model.js';
import {APPROVAL_OPTIONS, moveSelection} from '../../dialogs/dialogState.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useUIActions} from '../../contexts/UIActionsContext.js';
import {useUIState} from '../../contexts/UIStateContext.js';
import {truncateMiddle} from '../../theme/semanticTheme.js';

type Props = {approval: Approval};

/** submitting escalates to a warning when the engine stays silent this long. */
const ESCALATE_AFTER_MS = 10_000;
/** Below this the optimistic echo alone is enough — no waiting hint yet. */
const WAITING_HINT_AFTER_MS = 1_000;
/** Idle waits shorter than this need no elapsed-time display. */
const IDLE_ELAPSED_AFTER_MS = 60_000;
/** Beyond this, remind the user the run will keep waiting indefinitely. */
const IDLE_REMINDER_AFTER_MS = 600_000;

export function ApprovalDialog({approval}: Props) {
	const {theme} = useTheme();
	const {dispatch} = useUIState();
	const {decideApproval, cancelTask} = useUIActions();
	const [selected, setSelected] = useState(0);
	const hasFreeformInput = useRef(false);
	// One visible hint per freeform episode: silently eating a y/n/a press made
	// the dialog look dead ("selected yes, nothing happened").
	const freeformHintShown = useRef(false);
	// Same-tick duplicate guard: React state (approval.decision) may not have
	// re-rendered yet when a second keypress arrives in the same stdin chunk.
	const inFlight = useRef(false);
	const decision = approval.decision;
	const phase: 'idle' | 'submitting' | 'failed' = decision ? (decision.failed ? 'failed' : 'submitting') : 'idle';
	if (phase !== 'submitting') inFlight.current = false;

	// Ticks both the submitting feedback windows and the open-ended idle wait display.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		// Never keep the process alive just for the tick (same as useSharedSpinner).
		timer.unref?.();
		return () => clearInterval(timer);
	}, []);

	// A sandbox escape is one-time by design: the backend never persists trust
	// for it, so offering "Yes, always" here would be a lie.
	const allowAlways = !approval.description?.includes('[UNSANDBOXED');
	const options = allowAlways ? APPROVAL_OPTIONS : APPROVAL_OPTIONS.filter(o => o.id !== 'always');

	const decide = (value: 'y' | 'n' | 'a') => {
		if (inFlight.current) return;
		inFlight.current = true;
		dispatch({type: 'approval_decision_sent', id: approval.id, value, at: Date.now()});
		if (!decideApproval(approval, value)) {
			dispatch({type: 'approval_decision_failed', id: approval.id, reason: '命令发送失败（引擎进程不可用）'});
		}
	};

	const waitedMs = decision ? now - decision.sentAt : 0;
	const escalated = phase === 'submitting' && waitedMs >= ESCALATE_AFTER_MS;

	useInput((input, key) => {
		if (phase === 'failed' || escalated) {
			if (input === 'r' && decision) {
				inFlight.current = false;
				decide(decision.value);
				return;
			}
			if (key.escape) {
				cancelTask();
				return;
			}
			return;
		}
		if (phase === 'submitting') {
			// Decision already on the wire — swallow everything (the original
			// bug: N confirmations became N zombie DecideApproval writes).
			return;
		}
		if (key.upArrow) {
			setSelected(s => moveSelection(s, options.length, 'up'));
			return;
		}
		if (key.downArrow) {
			setSelected(s => moveSelection(s, options.length, 'down'));
			return;
		}
		if (key.escape) {
			decide('n');
			return;
		}
		const hasReturn = key.return === true || /[\r\n]/.test(input);
		const text = input.replace(/[\r\n]/g, '');
		const isTextDecision = isDecisionInput(text, allowAlways);
		if (hasReturn) {
			if (hasFreeformInput.current || (text.length > 0 && !isTextDecision)) {
				dispatch({type: 'notice', text: 'Approval is pending. Press y/n first.'});
				hasFreeformInput.current = false;
				freeformHintShown.current = false;
				return;
			}
			if (isTextDecision) {
				decide(text);
				return;
			}
			const option = options[selected];
			decide(option?.id === 'deny' ? 'n' : option?.id === 'once' ? 'y' : 'a');
			return;
		}
		if (input && hasFreeformInput.current) {
			// A decision key after stray text is guarded (it may be part of a word
			// like "yes"/"why"), but the guard must be VISIBLE — say it once.
			if (isDecisionInput(input, allowAlways) && !freeformHintShown.current) {
				freeformHintShown.current = true;
				dispatch({type: 'notice', text: 'Approval is pending. Press Enter to clear typed text, then y/n/a.'});
			}
			return;
		}
		if (input && !isDecisionInput(input, allowAlways)) {
			hasFreeformInput.current = true;
			return;
		}
		if (isDecisionInput(input, allowAlways)) {
			decide(input);
		}
	});

	const details = approvalDetails(approval);
	const riskDisplay = riskLabel(approval.risk);
	const idleWaitedMs = approval.requestedAt !== undefined ? Math.max(0, now - approval.requestedAt) : 0;

	if (phase === 'failed' && decision) {
		return (
			<Box flexDirection="column" borderStyle="round" borderColor={theme.status.danger} paddingX={2} marginBottom={1}>
				<Text color={theme.status.danger} bold wrap="wrap">审批决定未生效</Text>
				<Text wrap="wrap">{decision.failed}</Text>
				<Text dimColor wrap="wrap">已选择 {decisionLabel(decision.value)} · {truncateMiddle(details.subject, 80)}</Text>
				<Text dimColor wrap="wrap">r 重试 · Esc 取消当前运行</Text>
			</Box>
		);
	}

	if (phase === 'submitting' && decision) {
		const waitedSeconds = Math.floor(waitedMs / 1000);
		if (escalated) {
			return (
				<Box flexDirection="column" borderStyle="round" borderColor={theme.status.warning} paddingX={2} marginBottom={1}>
					<Text color={theme.status.warning} bold wrap="wrap">引擎未确认审批（已等待 {waitedSeconds}s）</Text>
					<Text dimColor wrap="wrap">已选择 {decisionLabel(decision.value)} · {truncateMiddle(details.subject, 80)}</Text>
					<Text dimColor wrap="wrap">{decision.acked ? '决定已送达引擎，但执行未继续。' : '决定尚未得到引擎回应。'}</Text>
					<Text dimColor wrap="wrap">r 重发 · Esc 取消当前运行</Text>
				</Box>
			);
		}
		return (
			<Box marginBottom={1} paddingX={1}>
				<Text wrap="wrap">
					<Text color={theme.status.success}>✓ </Text>
					<Text>已选择 {decisionLabel(decision.value)}</Text>
					<Text dimColor> · {truncateMiddle(details.subject, 60)}</Text>
					{waitedMs >= WAITING_HINT_AFTER_MS
						? <Text color={theme.status.warning}> · {decision.acked ? '执行中' : '等待引擎确认'}… {waitedSeconds}s</Text>
						: <Text dimColor> · 执行中…</Text>}
				</Text>
			</Box>
		);
	}

	// Vertical economy matters here: this dialog joins an already-populated
	// frame — every saved row is jitter headroom (see MainContent's
	// APPROVAL_DIALOG_RESERVE, which must stay in sync with this height).
	return (
		<Box flexDirection="column" borderStyle="round" borderColor={riskDisplay.borderColor ?? theme.status.warning} paddingX={2} marginBottom={1}>
			<Box>
				<Text bold wrap="wrap">{details.title}</Text>
				{riskDisplay.text ? <Text color={riskDisplay.color} bold wrap="wrap">{' '}[{riskDisplay.text}]</Text> : null}
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text dimColor wrap="wrap">{details.subjectLabel}</Text>
				<Text wrap="wrap">{truncateMiddle(details.subject, 120)}</Text>
				<Text color={riskDisplay.borderColor ?? theme.status.warning} wrap="wrap">{details.reason}</Text>
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text wrap="wrap">Do you want to proceed?</Text>
				{options.map((option, index) => (
					<Text key={option.id} wrap="wrap">
						<Text color={index === selected ? theme.text.accent : undefined}>
							{index === selected ? '❯ ' : '  '}{index + 1}. {option.label}
						</Text>
					</Text>
				))}
			</Box>
			<Text dimColor wrap="wrap">{allowAlways ? 'Esc to cancel · Enter to confirm · y yes · a always · n no' : 'Esc to cancel · Enter to confirm · y yes · n no (one-time only)'}</Text>
			{idleWaitedMs >= IDLE_ELAPSED_AFTER_MS && (
				<Text dimColor wrap="wrap">
					已等待 {elapsedLabel(idleWaitedMs)}
					{idleWaitedMs >= IDLE_REMINDER_AFTER_MS ? ' · run 将持续等待，可随时决定；Esc 拒绝' : ''}
				</Text>
			)}
		</Box>
	);
}

function decisionLabel(value: 'y' | 'n' | 'a'): string {
	return value === 'y' ? 'Yes' : value === 'a' ? 'Yes, always' : 'No';
}

function elapsedLabel(ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

function isDecisionInput(input: string, allowAlways = true): input is 'y' | 'a' | 'n' {
	return input === 'y' || input === 'n' || (allowAlways && input === 'a');
}

export function extractCommandFromToolCall(subject: string): string {
	if (!subject) return '';
	const trimmed = subject.trim();

	let toolName: string | undefined;
	let jsonStr = trimmed;

	// tool_name({...}) — closing ')' may be missing when the payload is truncated
	const match = trimmed.match(/^(\w+)\(([\s\S]*)$/);
	if (match?.[2] !== undefined && (match[2].startsWith('{') || match[2].startsWith('['))) {
		toolName = match[1];
		jsonStr = match[2].trim();
		if (jsonStr.endsWith(')')) {
			jsonStr = jsonStr.slice(0, -1).trim();
		}
	}

	if (toolName === 'edit_file') {
		try {
			const parsed = JSON.parse(jsonStr);
			if (parsed && typeof parsed === 'object') {
				const path = parsed.path ?? '';
				const oldStr = parsed.old_string ?? '';
				const newStr = parsed.new_string ?? '';
				if (oldStr || newStr) {
					return `edit_file(${path})\n--- old\n+++ new\n@@ ... @@\n${diffLines(oldStr, newStr)}`;
				}
				return path;
			}
		} catch {
			// truncated JSON — fall through to generic extraction
		}
	}

	const field = extractCommandField(jsonStr);
	if (field !== undefined) return field;
	return subject;
}

function extractCommandField(jsonStr: string): string | undefined {
	try {
		const parsed = JSON.parse(jsonStr);
		if (parsed && typeof parsed === 'object') {
			const cmd = parsed.command ?? parsed.args ?? parsed.input ?? parsed.file ?? parsed.path;
			if (typeof cmd === 'string') return cmd;
		}
	} catch {
		const fieldMatch = jsonStr.match(/"(?:command|args|input|file|path)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"?/);
		if (fieldMatch?.[1]) {
			try {
				return JSON.parse(`"${fieldMatch[1]}"`);
			} catch {
				return fieldMatch[1];
			}
		}
		const truncatedMatch = jsonStr.match(/"(?:command|args|input|file|path)"\s*:\s*"([^"]*)$/);
		if (truncatedMatch?.[1]) return truncatedMatch[1];
	}
	return undefined;
}

/** Build a compact diff-hunk representation of old → new string changes. */
function diffLines(oldStr: string, newStr: string): string {
	const oldLines = oldStr.split('\n');
	const newLines = newStr.split('\n');
	const result: string[] = [];
	const maxContext = 3;

	if (oldLines.length <= maxContext + 1 && newLines.length <= maxContext + 1) {
		for (const line of oldLines) result.push(`-${line}`);
		for (const line of newLines) result.push(`+${line}`);
		return result.join('\n');
	}

	const oldHead = oldLines.slice(0, maxContext);
	const oldTail = oldLines.slice(-maxContext);
	const newHead = newLines.slice(0, maxContext);
	const newTail = newLines.slice(-maxContext);
	const oldMidStart = maxContext;
	const oldMidEnd = Math.max(oldMidStart, oldLines.length - maxContext);
	const newMidStart = maxContext;
	const newMidEnd = Math.max(newMidStart, newLines.length - maxContext);

	for (const line of oldHead) result.push(`-${line}`);
	for (let i = oldMidStart; i < oldMidEnd; i++) {
		if ((oldLines[i] ?? '') !== (newLines[i] ?? '')) result.push(`-${oldLines[i]}`);
	}
	if (oldLines.length > maxContext * 2) {
		result.push(`-... (${oldLines.length - maxContext * 2} more lines)`);
	}
	for (const line of oldTail) result.push(`-${line}`);
	for (const line of newHead) result.push(`+${line}`);
	for (let i = newMidStart; i < newMidEnd; i++) {
		if ((oldLines[i] ?? '') !== (newLines[i] ?? '')) result.push(`+${newLines[i]}`);
	}
	if (newLines.length > maxContext * 2) {
		result.push(`+... (${newLines.length - maxContext * 2} more lines)`);
	}
	for (const line of newTail) result.push(`+${line}`);
	return result.join('\n');
}

function approvalDetails(approval: Approval): {
	title: string;
	subjectLabel: string;
	subject: string;
	intent: string;
	reason: string;
} {
	const rawSubject = approval.context || approval.description;
	const cleanedSubject = extractCommandFromToolCall(rawSubject);
	// External-directory gate: the decision is about the DIRECTORY, not the command.
	if (approval.risk?.toLowerCase() === 'external_directory') {
		const dirs = extractExternalDirectories(approval.description);
		const cmd = cleanedSubject
			? `${approval.tool === 'shell' ? '' : `[${approval.tool}] `}${cleanedSubject}`
			: '';
		return {
			title: 'External directory access',
			subjectLabel: dirs.length > 1 ? 'Directories' : 'Directory',
			subject: dirs.length > 0 ? dirs.join(', ') : cleanedSubject,
			intent: `Allow access to ${dirs.length > 0 ? dirs.join(', ') : 'paths outside the workspace'}?`,
			reason: cmd
				? `Command: ${cmd}\nThis command touches paths outside the workspace with no sandbox to contain side-effects. "Always" trusts the directory for this session.`
				: 'This command touches paths outside the workspace with no sandbox to contain side-effects. "Always" trusts the directory for this session.'
		};
	}
	const unsandboxed = approval.description?.includes('[UNSANDBOXED');
	switch (approval.tool) {
		case 'shell':
			return {
				title: unsandboxed ? 'Bash command (UNSANDBOXED)' : 'Bash command',
				subjectLabel: 'Command',
				subject: cleanedSubject,
				intent: describeShellIntent(cleanedSubject),
				reason: unsandboxed
					? 'Runs OUTSIDE the sandbox with FULL host access — only approve if the sandbox denial above was legitimate.'
					: describeShellRisk(cleanedSubject)
			};
		case 'delete_file':
			return {
				title: 'Delete file',
				subjectLabel: 'Target',
				subject: cleanedSubject || approval.context,
				intent: 'Delete a workspace file',
				reason: 'This operation removes files and cannot always be undone.'
			};
		case 'git':
			return {
				title: 'Git command',
				subjectLabel: 'Command',
				subject: cleanedSubject,
				intent: 'Run a git operation',
				reason: 'This command may change repository state or interact with a remote.'
			};
		default:
			return {
				title: `${approval.tool} approval`,
				subjectLabel: 'Target',
				subject: cleanedSubject,
				intent: approval.description,
				reason: approval.risk ? `Risk level: ${approval.risk}. This action requires approval.` : 'This action requires approval for safety.'
			};
	}
}

function describeShellIntent(command: string): string {
	const normalized = command.toLowerCase();
	if (normalized.includes('npm run dev') || normalized.includes('vite')) return 'Start development server';
	if (normalized.includes('npm install') || normalized.includes('pnpm install') || normalized.includes('yarn install')) return 'Install project dependencies';
	if (normalized.includes('npm create vite') || normalized.includes('create-vite')) return 'Create a Vite project';
	if (normalized.startsWith('git ')) return 'Run git command';
	if (normalized.includes('test')) return 'Run project tests';
	if (normalized.includes('build')) return 'Build the project';
	return 'Run shell command';
}

/** Directories listed by the runtime's external-directory gate:
 *  `... [external directories: /a, /b]`. */
export function extractExternalDirectories(description: string): string[] {
	const match = description?.match(/\[external directories:\s*([^\]]+)\]/);
	if (!match || !match[1]) return [];
	return match[1].split(',').map(d => d.trim()).filter(Boolean);
}

function riskLabel(risk: string): {text: string; color: string; borderColor?: string} {
	switch (risk.toLowerCase()) {
		case 'external_directory':
		case 'externaldirectory':
			return {text: 'ExternalDirectory', color: 'magenta', borderColor: 'magenta'};
		case 'readonly':
		case 'read_only':
			return {text: 'ReadOnly', color: 'green'};
		case 'workspacewrite':
		case 'workspace_write':
			return {text: 'WorkspaceWrite', color: 'yellow'};
		case 'shell':
			return {text: 'Shell', color: 'yellow', borderColor: 'yellow'};
		case 'destructive':
			return {text: 'Destructive', color: 'red', borderColor: 'red'};
		case 'externalsideeffect':
		case 'external_side_effect':
		case 'external':
			return {text: 'ExternalSideEffect', color: 'red', borderColor: 'red'};
		case 'humaninput':
		case 'human_input':
			return {text: 'HumanInput', color: 'cyan'};
		default:
			return {text: '', color: ''};
	}
}

function describeShellRisk(command: string): string {
	const normalized = command.toLowerCase();
	if (/[;&|`<>]/.test(command) || command.includes('$(')) {
		return 'This command uses shell operators that require approval for safety.';
	}
	if (/\s&\s*$/.test(command)) {
		return 'This command starts a background process that may keep running.';
	}
	if (normalized.includes('npm install') || normalized.includes('curl ') || normalized.includes('wget ') || normalized.includes('npx ')) {
		return 'This command may install packages or access the network.';
	}
	if (normalized.startsWith('git push') || normalized.startsWith('git pull')) {
		return 'This git command may interact with a remote repository.';
	}
	return 'This command can execute arbitrary code on your machine.';
}
