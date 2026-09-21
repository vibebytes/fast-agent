import type React from 'react';
import {composerGate} from '@fast-ide/session-view';
import type {DialogSpec} from './types.js';
import type {ActiveDialog} from '../dialogs/dialogState.js';
import {moveSelection} from '../dialogs/dialogState.js';
import type {ThemeName} from '../theme/semanticTheme.js';
import {getThemeNames} from '../theme/semanticTheme.js';
import type {RendererMode} from '../theme/themeStore.js';
import type {BridgeCommand, BridgeEvent} from '../rpc/protocol.js';
import {Command, matchKeybinding} from '../input/keybindings.js';
import {FOOTER_ITEMS} from '../components/dialogs/FooterConfigDialog.js';
import type {SessionInfo, UiState} from '../state/model.js';
import type {UiAction} from '../state/reducer.js';

export function sessionReadyFromState(state: UiState): boolean {
	return (
		state.ready &&
		Boolean(state.sessionId) &&
		state.inputMode !== 'exited' &&
		state.inputMode !== 'starting'
	);
}

/** Busy A′ — Goal track owns the session (drawer chrome); composer submit → Bridge Steer via chat. */
function goalKeepsBusy(card: UiState['goalCard']): boolean {
	return Boolean(
		card && (card.phase === 'started' || card.phase === 'paused' || card.phase === 'escalated')
	);
}

export function composerGateFromState(state: UiState) {
	const gate = composerGate(state.transcript, sessionReadyFromState(state));
	// Goal track: allow composer as 捎话 (Bridge routes Submit→Steer); Stop lives on Goal UI, not Esc.
	if (goalKeepsBusy(state.goalCard) && gate.runState === 'idle' && !gate.composerLocked) {
		return {
			...gate,
			runState: 'running' as const,
			canSubmitNow: true,
			canEnqueue: false,
			canCancel: false
		};
	}
	// Peer turn_started sets UiState.running even before activeRunId remap / streaming attach.
	if (state.running && gate.runState === 'idle' && !gate.composerLocked) {
		const ready = sessionReadyFromState(state);
		return {
			...gate,
			runState: 'running' as const,
			canSubmitNow: false,
			canEnqueue: ready,
			canCancel: true
		};
	}
	return gate;
}

export function createClientMessageId(): string {
	return `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function sessionIdFromEvent(event: BridgeEvent): string | undefined {
	switch (event.type) {
		case 'ready':
		case 'session_restored':
		case 'Attached':
		case 'Ack':
		case 'Heartbeat':
			return event.sessionId;
		default:
			return undefined;
	}
}

export function handleUiCommand(
	name: string,
	args: string,
	{showDialog, dispatch, rendererMode, setRendererMode, dumpCurrentFrame, startRecording, stopRecording}: {
		showDialog: (spec: DialogSpec, extraCtx?: Record<string, unknown>) => void;
		dispatch: React.Dispatch<UiAction>;
		rendererMode: RendererMode;
		setRendererMode: (mode: RendererMode) => void;
		dumpCurrentFrame: (filename: string) => void;
		startRecording: (filename: string) => void;
		stopRecording: () => void;
	}
): void {
	switch (name) {
		case 'tui': {
			const requested = args.trim().toLowerCase();
			if (requested !== '' && requested !== 'fullscreen' && requested !== 'inline') {
				dispatch({type: 'notice', text: '用法: /tui [fullscreen|inline]'});
				break;
			}
			const target: RendererMode = requested === ''
				? (rendererMode === 'fullscreen' ? 'inline' : 'fullscreen')
				: requested as RendererMode;
			setRendererMode(target);
			break;
		}
		case 'help':
			showDialog({type: 'help'});
			break;
		case 'shortcuts':
			showDialog({type: 'shortcuts'});
			break;
		case 'theme':
			showDialog({type: 'theme'});
			break;
		case 'footer':
			showDialog({type: 'footer'});
			break;
		case 'thinking':
			dispatch({type: 'cycle_thinking_display'});
			break;
		case 'clear-screen':
			dispatch({type: 'clear'});
			break;
		case 'clear-errors':
			dispatch({type: 'clear_errors'});
			break;
		case 'debug-events':
			showDialog({type: 'taskInspector'});
			break;
		case 'dump-frame':
			try {
				dumpCurrentFrame(args.trim() || 'debug/frame.json');
				dispatch({type: 'notice', text: `已导出当前帧 → ${args.trim() || 'debug/frame.json'}`});
			} catch (error) {
				dispatch({type: 'notice', text: `导出帧失败: ${String(error)}`});
			}
			break;
		case 'record-frames': {
			const file = args.trim() || 'debug/recording.json';
			if (file === 'stop') {
				stopRecording();
				dispatch({type: 'notice', text: '已停止录制'});
			} else {
				startRecording(file);
				dispatch({type: 'notice', text: `开始录制 → ${file}（/record-frames stop 结束）`});
			}
			break;
		}
		case 'retry':
			dispatch({type: 'notice', text: 'No user message to retry.'});
			break;
	}
}

export function handleDialogInput(
	dialog: ActiveDialog,
	input: {input: string; key: {upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean}},
	handlers: {
		closeDialog: () => void;
		updateDialog: (update: (dialog: ActiveDialog) => ActiveDialog) => void;
		setThemeName: (name: ThemeName) => void;
		dispatch: React.Dispatch<UiAction>;
		send: (command: BridgeCommand) => boolean;
		sessions: SessionInfo[];
		currentSessionId?: string;
		onResumeSession: (sessionId: string) => void;
		onDeleteSession: (sessionId: string) => void;
	}
): void {
	if (input.key.escape) {
		if (dialog.type === 'footer') {
			handlers.dispatch({type: 'set_footer_config', config: dialog.config});
		}
		handlers.closeDialog();
		return;
	}

	if (dialog.type === 'theme') {
		if (input.key.upArrow || input.key.downArrow) {
			handlers.updateDialog(current =>
				current.type === 'theme'
					? {...current, selected: moveSelection(current.selected, getThemeNames().length, input.key.upArrow ? 'up' : 'down')}
					: current
			);
			return;
		}
		if (input.key.return) {
			const selected = getThemeNames()[dialog.selected] ?? 'default-dark';
			handlers.setThemeName(selected);
			handlers.closeDialog();
		}
		return;
	}

	if (dialog.type === 'sessionBrowser') {
		const count = handlers.sessions.length;
		if (input.key.upArrow || input.key.downArrow) {
			handlers.updateDialog(current =>
				current.type === 'sessionBrowser'
					? {...current, selected: moveSelection(current.selected, Math.max(count, 1), input.key.upArrow ? 'up' : 'down')}
					: current
			);
			return;
		}
		if (input.input === 'x') {
			const selected = handlers.sessions[dialog.selected];
			if (selected && selected.id !== handlers.currentSessionId) {
				handlers.onDeleteSession(selected.id);
			}
			return;
		}
		if (input.key.return) {
			const selected = handlers.sessions[dialog.selected];
			if (selected && selected.id !== handlers.currentSessionId) {
				handlers.onResumeSession(selected.id);
			} else {
				handlers.closeDialog();
			}
			return;
		}
		return;
	}

	if (dialog.type === 'footer') {
		if (input.key.upArrow || input.key.downArrow) {
			handlers.updateDialog(current =>
				current.type === 'footer'
					? {...current, selected: moveSelection(current.selected, FOOTER_ITEMS.length, input.key.upArrow ? 'up' : 'down')}
					: current
			);
			return;
		}
		if (input.key.return) {
			const item = FOOTER_ITEMS[dialog.selected];
			if (item) {
				handlers.updateDialog(current =>
					current.type === 'footer'
						? {
							...current,
							config: {...current.config, [item.id]: !current.config[item.id]}
						}
						: current
				);
			}
			return;
		}
	}
}

export function routeAppKey(input: string, key: Record<string, any>, h: Record<string, any>): void {
	if (!h.trusted) return;

	if (h.dialogState.active) {
		handleDialogInput(h.dialogState.active, {input, key}, {
			closeDialog: h.closeDialogFn,
			updateDialog: h.updateDialog,
			setThemeName: h.setThemeName,
			dispatch: h.dispatch,
			send: h.send,
			sessions: h.state.sessions,
			currentSessionId: h.state.sessionId,
			onResumeSession: (sessionId: string) => {
				h.closeDialogFn();
				h.dispatch({type: 'clear'});
				h.send({type: 'command', name: 'resume', args: sessionId});
			},
			onDeleteSession: (sessionId: string) => {
				h.send({type: 'command', name: 'delete-session', args: sessionId});
			}
		});
		return;
	}

	const cmd = matchKeybinding({input, key});
	if (cmd === Command.CANCEL_TASK && key.ctrl) {
		if (h.state.running) {
			h.cancelCurrentRun();
			h.dispatch({type: 'local_cancel'});
		} else {
			h.stopAgent();
			h.exitApp();
		}
	}
	if (cmd === Command.TOGGLE_TOOL_DETAIL) {
		h.dispatch({type: 'toggle_tool_detail'});
	}
	if (cmd === Command.TOGGLE_HELP) {
		h.showDialog({type: 'help'});
	}
	if (cmd === Command.TOGGLE_FOOTER) {
		h.showDialog({type: 'footer'});
	}
	if (cmd === Command.GOAL_CARD) {
		h.dispatch({type: 'toggle_goal_card_focus'});
	}
	if (cmd === Command.SUBAGENT_DRILL) {
		const target = h.state.agentRuns.at(-1);
		if (target) {
			h.dispatch({
				type: 'agent_view_push',
				entry: {
					agentId: target.agentId,
					name: target.name,
					parentAgentId: target.parentAgentId,
					siblings: h.state.agentRuns
						.filter((run: {parentAgentId?: string}) => run.parentAgentId === target.parentAgentId)
						.map((run: {agentId: string; name: string}) => ({agentId: run.agentId, name: run.name}))
				}
			});
			if (h.state.sessionId) {
				h.send({type: 'FetchAgentTimeline', sessionId: h.state.sessionId, agentId: target.agentId});
			}
		} else if (h.state.definedAgents.length > 0) {
			h.dispatch({type: 'notice', text: `已定义 ${h.state.definedAgents.join('、')}，但还没有被调用；被调用后可用 Ctrl+G 查看运行情况`});
		} else {
			h.dispatch({type: 'notice', text: '当前没有子 agent 可查看'});
		}
	}
}
