import React from 'react';
import {render} from 'ink-testing-library';
import type {ReactElement} from 'react';
import {ThemeProvider} from '../contexts/ThemeContext.js';
import {UIStateContext} from '../contexts/UIStateContext.js';
import {UIActionsContext} from '../contexts/UIActionsContext.js';
import {CommandProvider} from '../contexts/CommandContext.js';
import {InputProvider} from '../contexts/InputContext.js';
import {initialState, type UiState} from '../state/model.js';
import type {UiAction} from '../state/reducer.js';
import {createCommandRegistry} from '../commands/registry.js';
import {initialSuggestionState} from '../suggestions/SuggestionEngine.js';
import type {BridgeCommand} from '../rpc/protocol.js';
import type {DialogSpec} from '../commands/types.js';
import type {Approval} from '../state/model.js';
import type {ThemeName} from '../theme/semanticTheme.js';

export type RenderWithProvidersOptions = {
	state?: UiState;
	themeName?: ThemeName;
	send?: (command: BridgeCommand) => boolean;
	dispatch?: React.Dispatch<UiAction>;
	decideApproval?: (approval: Approval, decision: 'y' | 'n' | 'a') => boolean;
	cancelTask?: () => void;
	history?: string[];
};

export function renderWithProviders(
	element: ReactElement,
	options: RenderWithProvidersOptions = {}
) {
	const state = options.state ?? initialState;
	const dispatch = options.dispatch ?? (() => undefined);
	const send = options.send ?? (() => true);
	const registry = createCommandRegistry(state.commands);

	return render(
		<ThemeProvider themeName={options.themeName ?? 'no-color'} setThemeName={() => undefined}>
			<UIStateContext.Provider value={{state, dispatch}}>
				<UIActionsContext.Provider
					value={{
						send,
						exit: () => undefined,
						showDialog: (_dialog: DialogSpec) => undefined,
						closeDialog: () => undefined,
						submitInput: () => undefined,
						answerQuestion: () => true,
						decideApproval: options.decideApproval ?? (() => true),
						confirmGoal: () => true,
						cancelGoal: () => true,
						resumeGoal: () => true,
						steerGoal: () => true,
						escalateGoal: () => true,
						cancelTask: options.cancelTask ?? (() => undefined),
						toggleHelp: () => undefined,
						toggleToolDetail: () => undefined,
						queryMentions: () => undefined,
						mentionGroups: [],
						mentionRequestId: null
					}}
				>
					<CommandProvider registry={registry}>
						<InputProvider
							value={{
								mode: state.inputMode,
								history: options.history ?? [],
								historyEnabled: true,
								suggestions: initialSuggestionState,
								reverseSearchActive: false
							}}
						>
							{element}
						</InputProvider>
					</CommandProvider>
				</UIActionsContext.Provider>
			</UIStateContext.Provider>
		</ThemeProvider>
	);
}

export function plainFrame(frame: string | undefined): string {
	return (frame ?? '')
		.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
		.replace(/[ \t]+$/gm, '')
		.trim();
}

type FrameApp = {lastFrame: () => string | undefined};
type InteractiveApp = FrameApp & {stdin: {write: (data: string) => void}};

/**
 * Deadline-based frame polling. Fixed `tick(ms)` sleeps flake under full-suite
 * CPU contention (ink renders slower than the sleep); polling until a deadline
 * is immune to slow frames while staying fast on the happy path.
 */
export async function waitForFrame(
	app: FrameApp,
	predicate: (plain: string) => boolean,
	what: string,
	timeoutMs = 8000
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let frame = plainFrame(app.lastFrame());
	while (!predicate(frame)) {
		if (Date.now() > deadline) {
			throw new Error(`timed out waiting for ${what}; last frame:\n${frame}`);
		}
		await new Promise(resolve => setTimeout(resolve, 25));
		frame = plainFrame(app.lastFrame());
	}
	return frame;
}

/**
 * Press a key until the frame reflects it. Components subscribe to stdin one
 * effect-commit AFTER they render (a keypress sent before that is silently
 * lost), so a single write races the commit. Only use with predicates that are
 * insensitive to extra presses (e.g. a single-item list, or "any selection").
 */
export async function pressUntil(
	app: InteractiveApp,
	key: string,
	predicate: (plain: string) => boolean,
	what: string,
	{attempts = 20, settleMs = 250}: {attempts?: number; settleMs?: number} = {}
): Promise<string> {
	for (let attempt = 0; attempt < attempts; attempt++) {
		app.stdin.write(key);
		const deadline = Date.now() + settleMs;
		while (Date.now() <= deadline) {
			const frame = plainFrame(app.lastFrame());
			if (predicate(frame)) return frame;
			await new Promise(resolve => setTimeout(resolve, 25));
		}
	}
	throw new Error(`${what}: not reached after ${attempts} presses of ${JSON.stringify(key)}; last frame:\n${plainFrame(app.lastFrame())}`);
}
