import React from 'react';
import {Box, Text} from 'ink';
import type {ActiveDialog} from '../dialogs/dialogState.js';
import {dialogTitle} from '../dialogs/dialogState.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {HelpDialog} from './dialogs/HelpDialog.js';
import {ShortcutsDialog} from './dialogs/ShortcutsDialog.js';
import {ThemeDialog} from './dialogs/ThemeDialog.js';
import {FooterConfigDialog} from './dialogs/FooterConfigDialog.js';
import {TaskInspectorDialog} from './dialogs/TaskInspectorDialog.js';
import {SessionBrowserDialog} from './dialogs/SessionBrowserDialog.js';
import {useUIState} from '../contexts/UIStateContext.js';
import {useTerminalSize} from '../hooks/useTerminalSize.js';

type Props = {
	dialog?: ActiveDialog;
	onClose: () => void;
	onResumeSession?: (sessionId: string) => void;
	onDeleteSession?: (sessionId: string) => void;
};

export function DialogManager({dialog, onClose, onResumeSession, onDeleteSession}: Props) {
	const {theme, themeName} = useTheme();
	const {state} = useUIState();
	const {rows} = useTerminalSize();
	if (!dialog) return null;

	return (
		<Box
			flexDirection="column"
			borderStyle="double"
			borderColor={theme.border.focus}
			paddingX={1}
			marginY={1}
			// Long content (30+ commands in /help) must clip instead of pushing
			// the composer/footer off the terminal.
			maxHeight={Math.max(8, rows - 6)}
			overflowY="hidden"
		>
			<Text color={theme.dialog.title} bold>{dialogTitle(dialog, theme)}</Text>
			<DialogContent
				dialog={dialog}
				themeName={themeName}
				sessions={state.sessions}
				currentSessionId={state.sessionId}
				onResumeSession={onResumeSession}
				onDeleteSession={onDeleteSession}
			/>
			<Text dimColor color={theme.dialog.footer}>↑↓ navigate • Enter confirm • Esc cancel</Text>
		</Box>
	);
}

function DialogContent({dialog, themeName, sessions, currentSessionId, onResumeSession, onDeleteSession}: {
	dialog: ActiveDialog;
	themeName: import('../theme/semanticTheme.js').ThemeName;
	sessions: import('../state/model.js').SessionInfo[];
	currentSessionId?: string;
	onResumeSession?: (sessionId: string) => void;
	onDeleteSession?: (sessionId: string) => void;
}) {
	switch (dialog.type) {
		case 'help':
			return <HelpDialog commands={dialog.commands} />;
		case 'shortcuts':
			return <ShortcutsDialog />;
		case 'theme':
			return <ThemeDialog selected={dialog.selected} currentTheme={themeName} />;
		case 'footer':
			return <FooterConfigDialog selected={dialog.selected} config={dialog.config} />;
		case 'taskInspector':
			return <TaskInspectorDialog runId={dialog.runId} events={dialog.events} />;
		case 'model':
			return <Text dimColor>Model selection via /model command</Text>;
		case 'sessionBrowser':
			return (
				<SessionBrowserDialog
					sessions={sessions}
					selected={dialog.selected}
					currentSessionId={currentSessionId}
				/>
			);
		default:
			return null;
	}
}
