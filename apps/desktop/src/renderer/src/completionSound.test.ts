import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {playApprovalSound, playCompletionSound, resetCompletionSound} from './completionSound.js';

type Automation = {kind: 'set' | 'ramp'; value: number; at: number};

class MockGain {
	readonly automations: Automation[] = [];
	readonly gain = {
		setValueAtTime: (value: number, at: number) => {
			this.automations.push({kind: 'set', value, at});
		},
		exponentialRampToValueAtTime: (value: number, at: number) => {
			this.automations.push({kind: 'ramp', value, at});
		}
	};
	connect(_dest: unknown): void {}
}

class MockOsc {
	startedAt: number | null = null;
	connect(_dest: unknown): void {}
	start(at: number): void {
		this.startedAt = at;
	}
	stop(_at: number): void {}
	frequency = {setValueAtTime: (_f: number, _at: number) => {}};
	type = 'sine';
}

class MockAudioContext {
	state: AudioContextState;
	currentTime: number;
	destination = {};
	readonly oscillators: MockOsc[] = [];
	readonly gains: MockGain[] = [];
	private readonly resumeWait: () => Promise<void>;

	constructor(opts: {
		state: AudioContextState;
		currentTime: number;
		resumeWait?: () => Promise<void>;
	}) {
		this.state = opts.state;
		this.currentTime = opts.currentTime;
		this.resumeWait = opts.resumeWait ?? (async () => {});
	}

	createOscillator(): MockOsc {
		const osc = new MockOsc();
		this.oscillators.push(osc);
		return osc;
	}

	createGain(): MockGain {
		const gain = new MockGain();
		this.gains.push(gain);
		return gain;
	}

	resume(): Promise<void> {
		return this.resumeWait().then(() => {
			this.state = 'running';
		});
	}

	close(): Promise<void> {
		this.state = 'closed';
		return Promise.resolve();
	}
}

let lastCtx: MockAudioContext | null = null;
let resumeGate: {release: () => void} | null = null;

function installMock(state: AudioContextState, currentTime: number, gateResume = false): MockAudioContext {
	resumeGate = null;
	const resumeWait = gateResume
		? () =>
				new Promise<void>(resolve => {
					resumeGate = {release: resolve};
				})
		: async () => {};
	const AC = class {
		constructor() {
			lastCtx = new MockAudioContext({state, currentTime, resumeWait});
			return lastCtx;
		}
	};
	(globalThis as unknown as {window: {AudioContext: unknown}}).window = {AudioContext: AC};
	return new Proxy({} as MockAudioContext, {
		get(_t, prop) {
			if (!lastCtx) throw new Error('AudioContext not constructed');
			return Reflect.get(lastCtx, prop);
		}
	});
}

describe('playCompletionSound', () => {
	beforeEach(() => {
		resetCompletionSound();
		lastCtx = null;
	});

	afterEach(() => {
		resetCompletionSound();
	});

	it('does not start oscillators while the context is still suspended', async () => {
		installMock('suspended', 0, true);
		const pending = playCompletionSound();
		assert.equal(lastCtx?.oscillators.length ?? 0, 0, 'must wait for resume — scheduling while suspended is silent');
		resumeGate?.release();
		await pending;
		assert.equal(lastCtx?.state, 'running');
		assert.equal(lastCtx?.oscillators.length, 2);
		assert.ok(lastCtx?.oscillators.every(o => o.startedAt != null));
	});

	it('schedules the chime after currentTime so gain ramps are not in the past', async () => {
		installMock('running', 12.5);
		await playCompletionSound();
		const starts = lastCtx?.oscillators.map(o => o.startedAt) ?? [];
		assert.equal(starts.length, 2);
		assert.ok(
			starts.every(t => t != null && t > 12.5),
			`start times must be strictly after currentTime, got ${starts.join(',')}`
		);
	});
});

describe('playApprovalSound', () => {
	beforeEach(() => {
		resetCompletionSound();
		lastCtx = null;
	});

	afterEach(() => {
		resetCompletionSound();
	});

	it('schedules a two-note ping after currentTime', async () => {
		installMock('running', 4);
		await playApprovalSound();
		const starts = lastCtx?.oscillators.map(o => o.startedAt) ?? [];
		assert.equal(starts.length, 2);
		assert.ok(
			starts.every(t => t != null && t > 4),
			`start times must be strictly after currentTime, got ${starts.join(',')}`
		);
	});
});
