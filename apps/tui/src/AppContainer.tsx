import React, {useCallback, useEffect, useMemo, useReducer, useRef, useState} from 'react';
import {useApp, useInput} from 'ink';
import {AgentProcess} from './rpc/AgentProcess.js';
import {resolveInkSessionConfig} from './rpc/sessionLaunch.js';
import {approvalsFromState, initialState, questionsFromState, type Approval} from './state/model.js';
import {reducer} from './state/reducer.js';
import {runIdFor} from './state/runId.js';
import {appendHistoryEntry, loadHistory} from './inputHistory.js';
import {isWorkspaceTrusted, trustWorkspace, workspaceRoot} from './security/workspaceTrust.js';
import {WorkspaceTrustGate} from './components/WorkspaceTrustGate.js';
import {AppLayout} from './layouts/AppLayout.js';
import {UIStateContext} from './contexts/UIStateContext.js';
import {UIActionsContext} from './contexts/UIActionsContext.js';
import {ThemeProvider} from './contexts/ThemeContext.js';
import {CommandProvider} from './contexts/CommandContext.js';
import {EventBridgeProvider} from './contexts/EventBridgeContext.js';
import {InputProvider} from './contexts/InputContext.js';
import {createCommandRegistry} from './commands/registry.js';
import {DebugServer, openBrowser} from './debug/DebugServer.js';
import {quickActionAvailability, routeSlashCommand} from './commands/router.js';
import {createSessionFromSlash} from './commands/metaCommands.js';
import type {DialogSpec} from './commands/types.js';
import {initialSuggestionState, type MentionSuggestGroup} from './suggestions/SuggestionEngine.js';
import type {MentionChip} from './components/Composer.js';
import {detectTerminalCapabilities} from './terminal/capabilityManager.js';
import {closeDialog, dialogFromSpec, initialDialogState, moveSelection, openDialog} from './dialogs/dialogState.js';
import type {ActiveDialog} from './dialogs/dialogState.js';
import type {ThemeName} from './theme/semanticTheme.js';
import {getThemeNames, hasTheme} from './theme/semanticTheme.js';
import {loadCustomThemes, loadSavedThemeName, saveThemeName, loadSavedRendererMode, saveRendererMode} from './theme/themeStore.js';
import type {RendererMode} from './theme/themeStore.js';
import {alternateScreenAllowed} from './terminal/alternateScreen.js';
import type {BackgroundInfo} from './terminal/backgroundDetect.js';
import type {BridgeCommand, BridgeEvent} from './rpc/protocol.js';
import {TERMINAL_PARSE_FAILURE_PREFIX} from './rpc/protocol.js';
import {logHostCommandResult} from './rpc/cliLog.js';
import {isSilentCommandResult} from './rpc/hostProtocolCommands.js';
import {Command, matchKeybinding} from './input/keybindings.js';
import {FOOTER_ITEMS} from './components/dialogs/FooterConfigDialog.js';
import {DeltaBatcher} from './rpc/DeltaBatcher.js';
import {CANCEL_SETTLEMENT_TIMEOUT_MS, canFlushQueuedInput, composerGate, seqTerminal} from '@fast-ide/session-view';
import {createTuiStreamSeq} from './rpc/tuiStreamSeq.js';
import type {UiState} from './state/model.js';

/** Session readiness folded into Composer Gate (not prompt lock). */
function sessionReadyFromState(state: UiState): boolean {
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

function composerGateFromState(state: UiState) {
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

type AppContainerProps = {
	/** OSC 11 probe result (detected before Ink mounts). */
	initialBackground?: BackgroundInfo;
};

export function AppContainer({initialBackground = {kind: 'unknown', hex: undefined}}: AppContainerProps = {}) {
	const {exit, setOptions, dumpCurrentFrame, startRecording, stopRecording} = useApp();
	const exitApp = useCallback(() => {
		exit();
	}, [exit]);
	const [state, dispatch] = useReducer(reducer, initialState);
	const agent = useMemo(() => new AgentProcess(), []);
	/** Same id as Hello / unix Attach (AgentProcess.clientId). */
	const clientId = agent.clientId;
	const sessionIdRef = useRef<string | undefined>(undefined);
	const attachedSessionRef = useRef<string | undefined>(undefined);
	const lastEventSeqRef = useRef(0);
	const seqGateRef = useRef(createTuiStreamSeq());
	const transcriptRef = useRef(state.transcript);
	/** Last outbound text — recover into Composer queue if Bridge races with `A turn is already running`. */
	const lastOutboundRef = useRef<{id: string; text: string} | null>(null);
	const debugServer = useMemo(() => new DebugServer(), []);
	const workspace = useMemo(() => workspaceRoot(), []);
	const [trusted, setTrusted] = useState(() => isWorkspaceTrusted(workspace));
	const [inputHistory, setInputHistory] = useState(() => loadHistory());
	const [dialogState, setDialogState] = useState(initialDialogState);
	const [mentionGroups, setMentionGroups] = useState<MentionSuggestGroup[]>([]);
	const [mentionRequestId, setMentionRequestId] = useState<string | null>(null);
	const caps = useMemo(() => detectTerminalCapabilities(), []);
	const [themeName, setThemeNameState] = useState<ThemeName>(() => {
		loadCustomThemes();
		if (caps.noColor || caps.screenReader) return 'no-color';
		const saved = loadSavedThemeName();
		if (saved && hasTheme(saved)) return saved;
		return initialBackground.kind === 'light' ? 'default-light' : 'default-dark';
	});

	// Renderer mode: fullscreen = Ink alternateBuffer via setOptions;
	// inline = overflowToBackbuffer on the Transcript viewport.
	const [rendererMode, setRendererModeState] = useState<RendererMode>(() => {
		if (loadSavedRendererMode() === 'fullscreen' && alternateScreenAllowed()) {
			return 'fullscreen';
		}
		return 'inline';
	});

	const setRendererMode = useCallback((mode: RendererMode) => {
		if (mode === rendererMode) return;
		if (mode === 'fullscreen') {
			if (!alternateScreenAllowed()) {
				dispatch({
					type: 'notice',
					text: '当前环境不支持全屏模式（非 TTY / screen reader / FAST_DISABLE_ALTERNATE_SCREEN=1）'
				});
				return;
			}
			// Ink setOptions only covers InkOptions (alt buffer / sticky headers).
			// incrementalRendering is constructor-only and is enabled at startup
			// for both modes (see main.tsx) so /tui switches keep the pipeline.
			setOptions({
				isAlternateBufferEnabled: true,
				stickyHeadersInBackbuffer: true
			});
			saveRendererMode('fullscreen');
			setRendererModeState('fullscreen');
			return;
		}
		setOptions({
			isAlternateBufferEnabled: false,
			stickyHeadersInBackbuffer: false
		});
		saveRendererMode('inline');
		setRendererModeState('inline');
	}, [rendererMode, setOptions]);

	// Theme changes: StaticRender deps include themeName, so settled history
	// re-renders automatically — no terminal clear / epoch bump needed.
	const setThemeName = useCallback((name: ThemeName) => {
		setThemeNameState(name);
		saveThemeName(name);
	}, []);

	// Coalesce streaming deltas (≤1 reducer dispatch per frame, order-preserving).
	const batcher = useMemo(() => new DeltaBatcher(event => {
		if (
			event.type === 'input_rejected'
			&& /turn is already running/i.test(event.reason)
		) {
			const pending = lastOutboundRef.current;
			if (pending) {
				lastOutboundRef.current = null;
				dispatch({type: 'enqueue_input', input: {id: pending.id, text: pending.text, state: 'queued'}});
			}
		}
		if (event.type === 'command_result' && isSilentCommandResult(event.name)) {
			logHostCommandResult({
				name: event.name ?? '?',
				status: event.status,
				message: event.message
			});
		}
		if (event.type === 'mention_suggestions') {
			setMentionRequestId(event.requestId);
			setMentionGroups(event.groups as MentionSuggestGroup[]);
		}
		dispatch({type: 'engine_event', event});
	}), []);
	useEffect(() => () => batcher.dispose(), [batcher]);

	const registry = useMemo(
		() => createCommandRegistry(state.commands),
		[state.commands]
	);

	const send = useCallback((command: BridgeCommand): boolean => {
		return agent.send(command);
	}, [agent]);

	/** Pin Thin Client Task session — bare `command` falls back to Engine host focus (often IDE's busy Task). */
	const sendPinnedCommand = useCallback((name: string, args: string): boolean => {
		const sessionId = state.sessionId;
		if (!sessionId) {
			dispatch({type: 'error', message: 'Engine session is not ready.'});
			return false;
		}
		return send({type: 'command', name, args, sessionId});
	}, [send, state.sessionId]);

	const sendUserMessage = useCallback((
		text: string,
		clientMessageId: string,
		mentions?: MentionChip[]
	): boolean => {
		if (!state.sessionId) {
			dispatch({type: 'error', message: 'Engine session is not ready.'});
			return false;
		}
		// Goal busy: Bridge handleUserMessage routes Submit→SteerGoal; confirm/start is skill-controlled.
		// Mentions chips passthrough — no Mentions.resolve on Submit.
		return send({
			type: 'SubmitUserMessage',
			sessionId: state.sessionId,
			clientMessageId,
			text,
			useModel: state.model,
			mentions: mentions && mentions.length > 0 ? mentions : undefined
		});
	}, [send, state.sessionId, state.model, dispatch]);

	const queryMentions = useCallback((prefix: string, requestId: string) => {
		if (!state.sessionId) return;
		send({type: 'MentionSuggest', sessionId: state.sessionId, prefix, requestId});
	}, [send, state.sessionId]);

	const sendAnswerQuestion = useCallback((
		id: string,
		answer: string | {selectedOptionId?: string; customText?: string}
	): boolean => {
		const target = questionsFromState(state).find(q => q.id === id);
		const sessionId = state.sessionId;
		const runId = runIdFor(state, target);
		if (!sessionId || !runId) {
			dispatch({type: 'error', message: 'Cannot answer question before session/run is ready.'});
			return false;
		}
		const structured = typeof answer === 'string'
			? {selectedOptionId: answer}
			: {
				selectedOptionId: answer.selectedOptionId?.trim() || undefined,
				customText: answer.customText?.trim() || undefined
			};
		return send({type: 'AnswerQuestion', sessionId, runId, questionId: id, ...structured});
	}, [send, state]);

	const sendApprovalDecision = useCallback((approval: Approval, decision: 'y' | 'n' | 'a'): boolean => {
		const sessionId = state.sessionId;
		const runId = runIdFor(state, approval);
		if (!sessionId || !runId) {
			dispatch({type: 'error', message: 'Cannot decide approval before session/run is ready.'});
			return false;
		}
		return send({
			type: 'DecideApproval',
			sessionId,
			runId,
			approvalId: approval.id,
			approved: decision !== 'n',
			reason: decision === 'a' ? 'always' : undefined
		});
	}, [send, state]);

	const confirmGoal = useCallback((goalId: string, patchJson?: string): boolean =>
		send(patchJson ? {type: 'ConfirmGoal', goalId, patchJson} : {type: 'ConfirmGoal', goalId}), [send]);

	const cancelGoal = useCallback((goalId: string): boolean =>
		send({type: 'CancelGoal', goalId}), [send]);

	const resumeGoal = useCallback((goalId: string): boolean =>
		send({type: 'ResumeGoal', goalId}), [send]);

	const steerGoal = useCallback((goalId: string, note: string): boolean =>
		send({type: 'SteerGoal', goalId, note}), [send]);

	const escalateGoal = useCallback((goalId: string, action: 'resume' | 'fail'): boolean =>
		send(action === 'resume' ? {type: 'EscalateResume', goalId} : {type: 'EscalateFail', goalId}), [send]);

	const cancelCurrentRun = useCallback((reason = 'cancelled by user'): boolean => {
		const sessionId = state.sessionId;
		if (!sessionId) {
			dispatch({type: 'error', message: 'Cannot cancel before session is ready.'});
			return false;
		}
		const runId = runIdFor(state);
		return runId
			? send({type: 'CancelRun', sessionId, runId, reason})
			: send({type: 'CancelSession', sessionId, reason});
	}, [send, state]);

	const sendRerunRun = useCallback(
		(runId: string): boolean => {
			const sessionId = state.sessionId;
			if (!sessionId) {
				dispatch({type: 'error', message: 'Engine session is not ready.'});
				return false;
			}
			dispatch({type: 'rerun_started', runId});
			return send({type: 'RerunRun', sessionId, runId});
		},
		[send, state.sessionId]
	);

	const sendContinueMessage = useCallback((): boolean => {
		const clientMessageId = createClientMessageId();
		dispatch({type: 'submit_user', text: 'continue', clientMessageId});
		return sendUserMessage('continue', clientMessageId);
	}, [sendUserMessage]);

	// Bare r/c quick keys (doc §8): active only when "last terminal + idle".
	const quickActions = useMemo(
		() => quickActionAvailability(state),
		[state]
	);
	const onQuickKey = useCallback(
		(ch: 'r' | 'c') => {
			if (ch === 'r') {
				if (!quickActions.retryRunId) return;
				if (!sendRerunRun(quickActions.retryRunId)) {
					dispatch({type: 'engine_exit', code: null, signal: 'SIGPIPE'});
				}
				return;
			}
			if (!quickActions.continueReady) return;
			if (!sendContinueMessage()) {
				dispatch({type: 'engine_exit', code: null, signal: 'SIGPIPE'});
			}
		},
		[quickActions, sendRerunRun, sendContinueMessage, dispatch]
	);

	const stopAgent = useCallback(() => {
		const sessionId = sessionIdRef.current;
		if (sessionId) {
			agent.stop({type: 'DetachSession', sessionId, clientId});
			return;
		}
		agent.stop();
	}, [agent, clientId]);

	const toggleDebug = useCallback(async (on: boolean): Promise<void> => {
		if (on) {
			dispatch({type: 'toggle_debug', visible: true});
			send({type: 'command', name: 'debug', args: 'on'});
			try {
				const url = await debugServer.start();
				dispatch({type: 'set_debug_url', url});
				openBrowser(url);
				dispatch({type: 'notice', text: `LLM debug page → ${url}`});
			} catch (error) {
				dispatch({type: 'notice', text: `Debug server failed to start: ${String(error)}`});
			}
		} else {
			send({type: 'command', name: 'debug', args: 'off'});
			debugServer.stop();
			dispatch({type: 'toggle_debug', visible: false});
		}
	}, [debugServer, send]);

	const showDialog = useCallback((spec: DialogSpec, extraCtx?: Record<string, unknown>) => {
		setDialogState(current => openDialog(current, dialogFromSpec(spec, Object.assign(
			{
				commands: registry.allInfo(),
				debugEvents: state.debugEvents,
				footerConfig: state.footerConfig,
			},
			extraCtx,
		))));
	}, [registry, state.commands, state.debugEvents, state.footerConfig]);

	const closeDialogFn = useCallback(() => {
		setDialogState(current => closeDialog(current));
	}, []);

	const updateDialog = useCallback((update: (dialog: ActiveDialog) => ActiveDialog) => {
		setDialogState(current => {
			if (!current.active) return current;
			return {...current, active: update(current.active)};
		});
	}, []);

	useEffect(() => {
		if (!trusted) return;
		agent.start({
			onEvent: event => {
				const eventSessionId = sessionIdFromEvent(event);
				if (eventSessionId) {
					sessionIdRef.current = eventSessionId;
				}
				const sessionId = eventSessionId ?? sessionIdRef.current;
				const transcript = transcriptRef.current;
				const result = seqGateRef.current.onEvent(event, {terminal: seqTerminal(transcript)});
				if (result.lastApplied !== lastEventSeqRef.current && sessionId) {
					lastEventSeqRef.current = result.lastApplied;
					agent.send({type: 'Ack', sessionId, clientId, lastEventSeq: result.lastApplied});
				}
				for (const ev of result.emit) batcher.push(ev);
				if (result.resync && sessionId) {
					agent.send({
						type: 'AttachSession',
						sessionId,
						clientId,
						lastEventSeq: result.lastApplied,
						limit: 50
					});
				}
			},
			onError: message => {
				if (message.startsWith(TERMINAL_PARSE_FAILURE_PREFIX)) {
					const sessionId = sessionIdRef.current;
					if (sessionId) {
						agent.send({
							type: 'AttachSession',
							sessionId,
							clientId,
							lastEventSeq: lastEventSeqRef.current,
							limit: 50
						});
					}
					dispatch({type: 'notice', text: message});
					return;
				}
				batcher.flush();
				dispatch({type: 'error', message});
			},
			onExit: (code, signal) => {
				batcher.flush();
				dispatch({type: 'engine_exit', code, signal});
			}
		}, resolveInkSessionConfig());
		return () => stopAgent();
	}, [agent, batcher, clientId, stopAgent, trusted]);

	useEffect(() => {
		sessionIdRef.current = state.sessionId;
	}, [state.sessionId]);

	useEffect(() => {
		transcriptRef.current = state.transcript;
	}, [state.transcript]);

	useEffect(() => {
		// Unix Machine-scoped path: AgentProcess already AttachSession after EnsureProject.
		if (agent.ownsAttach) {
			if (state.sessionId) attachedSessionRef.current = state.sessionId;
			return;
		}
		if (!trusted || !state.ready || !state.sessionId || attachedSessionRef.current === state.sessionId) {
			return;
		}
		if (send({type: 'AttachSession', sessionId: state.sessionId, clientId, lastEventSeq: lastEventSeqRef.current, limit: 50})) {
			attachedSessionRef.current = state.sessionId;
		}
	}, [agent.ownsAttach, clientId, send, state.ready, state.sessionId, trusted]);

	useEffect(() => () => debugServer.stop(), [debugServer]);

	// Liveness probe: the engine echoes every Heartbeat, so `lastEngineEventAt`
	// keeps advancing while it is healthy — even when idle or waiting on an
	// approval. The footer flags silence >5s BEFORE the user interacts with a
	// dialog whose engine is already gone.
	useEffect(() => {
		if (!state.ready || !state.sessionId || state.inputMode === 'exited') return;
		const sessionId = state.sessionId;
		const timer = setInterval(() => {
			send({type: 'Heartbeat', sessionId, clientId, atMillis: Date.now()});
		}, 3000);
		return () => clearInterval(timer);
	}, [clientId, send, state.ready, state.sessionId, state.inputMode]);

	useEffect(() => {
		if (state.debugVisible && state.debugUrl) {
			debugServer.publish({requests: state.llmRequests, model: state.modelDisplay ?? state.model});
		}
	}, [debugServer, state.debugVisible, state.debugUrl, state.llmRequests, state.model, state.modelDisplay]);

	useEffect(() => {
		// Composer Gate: boot buffer (null terminal) or post-turn finished — never cancel.
		if (
			!canFlushQueuedInput({
				sessionReady: sessionReadyFromState(state),
				running: state.running,
				queuePaused: state.queuePaused,
				queueLength: state.queue.length,
				lastTurnTerminal: state.lastTurnTerminal
			})
		)
			return;
		const input = state.queue[0];
		if (!input) return;
		dispatch({type: 'dequeue_input', id: input.id});
		const routed = routeSlashCommand(input.text, state);
		if (routed?.kind === 'skillCandidate' || routed?.kind === 'engine') {
			lastOutboundRef.current = {id: input.id, text: input.text};
			dispatch({type: 'collapse_command_menus'});
			if (routed.kind === 'engine') {
				dispatch({type: 'submit_command', text: input.text, clientMessageId: input.id});
			}
			if (!sendPinnedCommand(routed.name, routed.args)) {
				dispatch({type: 'engine_exit', code: null, signal: 'SIGPIPE'});
			}
			return;
		}
		lastOutboundRef.current = {id: input.id, text: input.text};
		dispatch({type: 'submit_user', text: input.text, clientMessageId: input.id});
		if (!sendUserMessage(input.text, input.id, input.mentions)) {
			dispatch({type: 'engine_exit', code: null, signal: 'SIGPIPE'});
		}
	}, [
		sendPinnedCommand,
		sendUserMessage,
		state,
		state.ready,
		state.sessionId,
		state.inputMode,
		state.running,
		state.queuePaused,
		state.lastTurnTerminal,
		state.queue
	]);

	/** ADR-0007: unlock Composer if turn_cancelled never arrives (~12s, matches Fast IDE). */
	useEffect(() => {
		if (!state.transcript.awaitingCancelSettlement) return;
		const timer = setTimeout(() => {
			dispatch({type: 'force_cancel_settlement', reason: 'client settlement timeout'});
		}, CANCEL_SETTLEMENT_TIMEOUT_MS);
		return () => clearTimeout(timer);
	}, [state.transcript.awaitingCancelSettlement]);

	const submitInput = useCallback((text: string, mentions?: MentionChip[]) => {
		setInputHistory(current => appendHistoryEntry(text, current));

		const routed = routeSlashCommand(text, state);
		if (routed) {
			switch (routed.kind) {
				case 'quit':
					stopAgent();
					exitApp();
					return;
				case 'retry': {
					const clientMessageId = createClientMessageId();
					dispatch({type: 'submit_user', text: routed.lastUserText, clientMessageId});
					if (!sendUserMessage(routed.lastUserText, clientMessageId)) {
						dispatch({type: 'engine_exit', code: null, signal: 'SIGPIPE'});
					}
					return;
				}
				case 'rerun': {
					if (!sendRerunRun(routed.runId)) {
						dispatch({type: 'engine_exit', code: null, signal: 'SIGPIPE'});
					}
					return;
				}
				case 'continue': {
					if (!sendContinueMessage()) {
						dispatch({type: 'engine_exit', code: null, signal: 'SIGPIPE'});
					}
					return;
				}
				case 'blocked':
					dispatch({type: 'notice', text: routed.reason});
					return;
				case 'ui':
					handleUiCommand(routed.spec.name, routed.args, {
						showDialog: (spec: DialogSpec) => showDialog(spec, spec.type === 'theme' ? {currentTheme: themeName} : undefined),
						dispatch,
						rendererMode,
						setRendererMode,
						dumpCurrentFrame,
						startRecording,
						stopRecording
					});
					return;
				case 'hybrid':
					if (routed.uiDebug) {
						void toggleDebug(routed.args !== 'off');
						return;
					}
					if (routed.uiSessionBrowser) {
						showDialog({type: 'sessionBrowser'});
						sendPinnedCommand('sessions', '');
						return;
					}
					if (routed.uiUndo) {
						dispatch({type: 'undo_last_exchange'});
					}
					if (routed.name === 'new' || routed.name === 'reset' || routed.name === 'clear') {
						send(createSessionFromSlash(routed.args));
					} else {
						const gate = composerGateFromState(state);
						if (gate.canEnqueue) {
							dispatch({type: 'enqueue_input', input: {id: createClientMessageId(), text, state: 'queued'}});
							return;
						}
						sendPinnedCommand(routed.name, routed.args);
					}
					if (routed.uiClear) {
						dispatch({type: 'clear'});
					}
					return;
				case 'engine': {
					const gate = composerGateFromState(state);
					if (gate.canEnqueue) {
						dispatch({type: 'enqueue_input', input: {id: createClientMessageId(), text, state: 'queued'}});
						return;
					}
					const clientMessageId = createClientMessageId();
					lastOutboundRef.current = {id: clientMessageId, text};
					dispatch({type: 'submit_command', text, clientMessageId});
					if (!sendPinnedCommand(routed.name, routed.args)) {
						dispatch({type: 'engine_exit', code: null, signal: 'SIGPIPE'});
					}
					return;
				}
				case 'skillCandidate': {
					// SkillSlash: Bridge emits skill_view tool events then ordinary turn stream.
					// Must honour Composer Gate (IDE peer turn) — never bare-send into a busy SessionTurn.
					const gate = composerGateFromState(state);
					if (gate.canEnqueue) {
						dispatch({type: 'enqueue_input', input: {id: createClientMessageId(), text, state: 'queued'}});
						return;
					}
					if (!gate.canSubmitNow) {
						dispatch({
							type: 'notice',
							text: gate.composerLocked
								? 'Cannot send yet — finish the pending prompt first.'
								: 'Cannot send yet — wait for the session to be ready.'
						});
						return;
					}
					const clientMessageId = createClientMessageId();
					lastOutboundRef.current = {id: clientMessageId, text};
					dispatch({type: 'collapse_command_menus'});
					if (!sendPinnedCommand(routed.name, routed.args)) {
						dispatch({type: 'engine_exit', code: null, signal: 'SIGPIPE'});
					}
					return;
				}
				case 'unknown':
					dispatch({type: 'notice', text: `Unknown command: /${routed.name}`});
					return;
			}
		}

		if (state.transcript.approvals.length > 0) {
			dispatch({type: 'notice', text: 'Approval is pending. Press y/n first.'});
			return;
		}

		const question = questionsFromState(state).at(-1);
		if (question) {
			const option = question.options.find(c => c.id === text || c.label === text);
			sendAnswerQuestion(
				question.id,
				option ? {selectedOptionId: option.id} : {customText: text}
			);
			return;
		}

		// Approvals / questions answered above; Composer Gate owns enqueue vs submit.
		const gate = composerGateFromState(state);
		const queued = {
			id: createClientMessageId(),
			text,
			state: 'queued' as const,
			...(mentions && mentions.length > 0 ? {mentions} : {})
		};
		if (gate.canEnqueue) {
			dispatch({type: 'enqueue_input', input: queued});
			return;
		}
		if (gate.canSubmitNow) {
			const clientMessageId = createClientMessageId();
			lastOutboundRef.current = {id: clientMessageId, text};
			dispatch({type: 'submit_user', text, clientMessageId});
			if (!sendUserMessage(text, clientMessageId, mentions)) {
				dispatch({type: 'engine_exit', code: null, signal: 'SIGPIPE'});
			}
			return;
		}
		// Host boot buffer: Session not ready yet — still accept typed input into the queue.
		if (!sessionReadyFromState(state) && !gate.composerLocked) {
			dispatch({type: 'enqueue_input', input: queued});
			return;
		}
		dispatch({
			type: 'notice',
			text: gate.composerLocked
				? 'Cannot send yet — finish the pending prompt first.'
				: 'Cannot send yet — wait for the session to be ready.'
		});
	}, [dispatch, exitApp, send, sendAnswerQuestion, sendPinnedCommand, sendUserMessage, showDialog, state, stopAgent, toggleDebug, rendererMode, setRendererMode, dumpCurrentFrame, startRecording, stopRecording, themeName]);

	useInput((input, key) => {
		if (!trusted) return;

		if (dialogState.active) {
			handleDialogInput(dialogState.active, {input, key}, {
				closeDialog: closeDialogFn,
				updateDialog,
				setThemeName,
				dispatch,
				send,
				sessions: state.sessions,
				currentSessionId: state.sessionId,
				onResumeSession: (sessionId: string) => {
					closeDialogFn();
					dispatch({type: 'clear'});
					send({type: 'command', name: 'resume', args: sessionId});
				},
				onDeleteSession: (sessionId: string) => {
					send({type: 'command', name: 'delete-session', args: sessionId});
				}
			});
			return;
		}

		const cmd = matchKeybinding({input, key});
		if (cmd === Command.CANCEL_TASK && key.ctrl) {
			if (state.running) {
				cancelCurrentRun();
				dispatch({type: 'local_cancel'});
			} else {
				stopAgent();
				exitApp();
			}
		}
		if (cmd === Command.TOGGLE_TOOL_DETAIL) {
			// Single dispatch — toggle_tool_detail and toggle_file both flip
			// toolsExpanded; dispatching both used to cancel each other out.
			dispatch({type: 'toggle_tool_detail'});
		}
		if (cmd === Command.TOGGLE_HELP) {
			showDialog({type: 'help'});
		}
		if (cmd === Command.TOGGLE_FOOTER) {
			showDialog({type: 'footer'});
		}
		if (cmd === Command.GOAL_CARD) {
			dispatch({type: 'toggle_goal_card_focus'});
		}
		if (cmd === Command.SUBAGENT_DRILL) {
			// Drill into the most recent subagent (design §11.2). Siblings share
			// the same parent, enabling ←/→ lateral switching in the sub-view.
			const target = state.agentRuns.at(-1);
			if (target) {
				dispatch({
					type: 'agent_view_push',
					entry: {
						agentId: target.agentId,
						name: target.name,
						parentAgentId: target.parentAgentId,
						siblings: state.agentRuns
							.filter(run => run.parentAgentId === target.parentAgentId)
							.map(run => ({agentId: run.agentId, name: run.name}))
					}
				});
				if (state.sessionId) {
					send({type: 'FetchAgentTimeline', sessionId: state.sessionId, agentId: target.agentId});
				}
			} else if (state.definedAgents.length > 0) {
				// "没有子 agent" would be misleading here: agents exist, the main
				// agent just hasn't delegated to them (call_agent) yet.
				dispatch({type: 'notice', text: `已定义 ${state.definedAgents.join('、')}，但还没有被调用；被调用后可用 Ctrl+G 查看运行情况`});
			} else {
				dispatch({type: 'notice', text: '当前没有子 agent 可查看'});
			}
		}
		// Esc semantics (cancel run vs scroll-to-bottom vs drill-down back)
		// are arbitrated in ONE place: AppLayout's useInput. Do not add a
		// second Esc handler here — ink broadcasts keys to all active handlers.
	});

	// Memoized context values — inline object literals gave every consumer a
	// fresh identity per render (hooks stay above the trust-gate early return).
	const uiStateValue = useMemo(() => ({state, dispatch}), [state, dispatch]);
	const actions = useMemo(() => ({
		send,
		exit: () => { stopAgent(); exitApp(); },
		showDialog,
		closeDialog: closeDialogFn,
		submitInput,
		answerQuestion: sendAnswerQuestion,
		decideApproval: sendApprovalDecision,
		confirmGoal,
		cancelGoal,
		resumeGoal,
		steerGoal,
		escalateGoal,
		cancelTask: () => { cancelCurrentRun(); dispatch({type: 'local_cancel'}); },
		toggleHelp: () => showDialog({type: 'help'}),
		toggleToolDetail: (path?: string) => {
			dispatch({type: 'toggle_file', path});
		},
		queryMentions,
		mentionGroups,
		mentionRequestId
	}), [
		send, stopAgent, exitApp, showDialog, closeDialogFn, submitInput,
		sendAnswerQuestion, sendApprovalDecision, confirmGoal, cancelGoal,
		resumeGoal, steerGoal, escalateGoal, cancelCurrentRun, dispatch,
		queryMentions, mentionGroups, mentionRequestId
	]);
	const inputContextValue = useMemo(() => ({
		mode: state.inputMode,
		history: inputHistory,
		historyEnabled: state.inputMode !== 'approval' && state.inputMode !== 'question',
		suggestions: initialSuggestionState,
		reverseSearchActive: false
	}), [state.inputMode, inputHistory]);

	if (!trusted) {
		// ThemeProvider wraps the gate too — it renders before the main tree,
		// and semantic tokens must not silently fall back to default-dark.
		return (
			<ThemeProvider
				themeName={themeName}
				setThemeName={setThemeName}
				terminalBackground={initialBackground.hex}
			>
				<WorkspaceTrustGate
					workspace={workspace}
					onTrust={() => { trustWorkspace(workspace); setTrusted(true); }}
					onExit={() => { stopAgent(); exitApp(); }}
				/>
			</ThemeProvider>
		);
	}

	return (
		<ThemeProvider
			themeName={themeName}
			setThemeName={setThemeName}
			terminalBackground={initialBackground.hex}
		>
			<UIStateContext.Provider value={uiStateValue}>
				<UIActionsContext.Provider value={actions}>
					<EventBridgeProvider agent={agent}>
						<CommandProvider registry={registry}>
							<InputProvider value={inputContextValue}>
								<AppLayout
									dialog={dialogState.active}
									rendererMode={rendererMode}
									onCloseDialog={closeDialogFn}
									onQuestionAnswer={sendAnswerQuestion}
									onQuickKey={onQuickKey}
									quickActions={{
										retry: quickActions.retryRunId !== null,
										cont: quickActions.continueReady
									}}
									onResumeSession={sessionId => {
										closeDialogFn();
										dispatch({type: 'clear'});
										send({type: 'command', name: 'resume', args: sessionId});
									}}
									onDeleteSession={sessionId => send({type: 'command', name: 'delete-session', args: sessionId})}
								/>
							</InputProvider>
						</CommandProvider>
					</EventBridgeProvider>
				</UIActionsContext.Provider>
			</UIStateContext.Provider>
		</ThemeProvider>
	);
}

function createClientMessageId(): string {
	return `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function sessionIdFromEvent(event: BridgeEvent): string | undefined {
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

function handleUiCommand(
	name: string,
	args: string,
	{showDialog, dispatch, rendererMode, setRendererMode, dumpCurrentFrame, startRecording, stopRecording}: {
		showDialog: (spec: DialogSpec, extraCtx?: Record<string, unknown>) => void;
		dispatch: React.Dispatch<import('./state/reducer.js').UiAction>;
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

function handleDialogInput(
	dialog: ActiveDialog,
	input: {input: string; key: {upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean}},
	handlers: {
		closeDialog: () => void;
		updateDialog: (update: (dialog: ActiveDialog) => ActiveDialog) => void;
		setThemeName: (name: ThemeName) => void;
		dispatch: React.Dispatch<import('./state/reducer.js').UiAction>;
		send: (command: BridgeCommand) => boolean;
		sessions: import('./state/model.js').SessionInfo[];
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
