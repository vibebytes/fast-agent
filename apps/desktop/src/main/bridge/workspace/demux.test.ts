import assert from 'node:assert/strict';
import test from 'node:test';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import {createDemux, type DemuxHost, type DemuxProject} from './demux.js';

type CommandResult = Extract<BridgeEvent, {type: 'command_result'}>;

const restartAck = (): CommandResult =>
	({
		type: 'command_result',
		name: 'RestartMainSession',
		message: 'new-sess',
		status: 'accepted'
	}) as CommandResult;

function makeHost(projects: DemuxProject[]) {
	const engineEvents: BridgeEvent[] = [];
	const host = {
		engineStatus: 'ready',
		engineHandlers: null,
		lastReady: null,
		projects: new Map(projects.map(p => [p.id, p])),
		bridge: null,
		adopt: {handleCommand: () => false, handleSessionsList: () => {}},
		hostWait: {resolveByRequestId: () => {}, resolveByName: () => {}, hostError: () => {}},
		composerHeal: {},
		setEngineStatus: () => {},
		armStableLease: () => {},
		getActive: () => projects[0] ?? null,
		isRemote: () => false,
		requestWorkspaceMeta: () => false,
		refreshPickerEngines: () => {},
		schedulePickerRefresh: () => {},
		fanoutCheckoutPush: () => false,
		fanoutSessionChrome: () => {},
		isLocalSaveEcho: () => false,
		handleBareError: () => false,
		projectForHash: () => null,
		projectForSession: () => null
	} as unknown as DemuxHost;
	const handlers = {
		onEvent: (_projectId: string, event: BridgeEvent) => {
			if (_projectId === 'engine') engineEvents.push(event);
		},
		onLog: () => {},
		onError: () => {}
	} as unknown as Parameters<ReturnType<typeof createDemux>['dispatchCommandResult']>[1];
	return {host, handlers, engineEvents};
}

test('RestartMainSession ack settles every project controller, not just the active one', () => {
	const seen: string[] = [];
	const projects: DemuxProject[] = ['a', 'b'].map(id => ({
		id,
		path: `/${id}`,
		status: 'ready',
		isDefault: id === 'a',
		sessions: {handleEvent: () => seen.push(id)}
	}));
	const {host, handlers, engineEvents} = makeHost(projects);
	const demux = createDemux(host);

	const handled = demux.dispatchCommandResult(restartAck(), handlers);

	assert.equal(handled, true);
	assert.deepEqual(seen.sort(), ['a', 'b']);
	assert.equal(engineEvents.length, 1);
});

test('unrelated commands are not fanned out to project controllers', () => {
	const seen: string[] = [];
	const projects: DemuxProject[] = [
		{
			id: 'a',
			path: '/a',
			status: 'ready',
			isDefault: true,
			sessions: {handleEvent: () => seen.push('a')}
		}
	];
	const {host, handlers} = makeHost(projects);
	const demux = createDemux(host);

	const handled = demux.dispatchCommandResult(
		{type: 'command_result', name: 'SomethingElse', message: '', status: 'accepted'} as CommandResult,
		handlers
	);

	assert.equal(handled, false);
	assert.deepEqual(seen, []);
});
