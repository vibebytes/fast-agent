import {initialState} from '../model.js';
import {reducer} from '../reducer.js';

/** Shared fixtures for reducer.test domains. */

export function stateWithApproval() {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'engine_event', event: {
		type: 'approval_requested', id: 'appr_1', runId: 'run_1', turnId: 'turn_1', tool: 'shell',
		description: 'Run command', risk: 'Shell', context: 'rm -rf x'
	}});
	return state;
}

export function cancelledRunState() {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'install libreoffice', clientMessageId: 'c1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 'run-1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'reasoning_delta', turnId: 'run-1', text: 'installing…'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'run_cancelled', runId: 'run-1', reason: 'cancelled'}});
	return state;
}

export function runWithTool(tool: string, args: Record<string, string>, success = true) {
	let state = reducer(initialState, {type: 'engine_event', event: {type: 'ready'}});
	state = reducer(state, {type: 'submit_user', text: 'go', clientMessageId: 'c1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'c1', turnId: 'run-1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_started', turnId: 'run-1', id: 'tc-1', tool, args}});
	state = reducer(state, {type: 'engine_event', event: {type: 'tool_finished', turnId: 'run-1', id: 'tc-1', tool, success, fields: {}}});
	return state;
}

export function turnWithAnswer(text: string) {
	let state = reducer(initialState, {type: 'submit_user', text: 'hi', clientMessageId: 'client_1'});
	state = reducer(state, {type: 'engine_event', event: {type: 'input_accepted', clientMessageId: 'client_1', turnId: 'turn_1'}});
	state = reducer(state, {type: 'engine_event', event: {type: 'assistant_delta', turnId: 'turn_1', text}});
	state = reducer(state, {type: 'engine_event', event: {type: 'turn_finished', turnId: 'turn_1', success: true}});
	return state;
}
