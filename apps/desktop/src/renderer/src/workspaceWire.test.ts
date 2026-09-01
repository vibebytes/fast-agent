import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {TasksSnapshot} from './env';
import {createWorkspaceStore} from './workspaceStore.js';
import {pullTaskBodies} from './workspaceWire.js';

const idleGate = {
	runState: 'idle' as const,
	canSubmitNow: false,
	canEnqueue: false,
	canCancel: false,
	composerLocked: false,
	lockReason: null
};

function emptyTasks(): TasksSnapshot {
	return {
		tasks: [],
		chats: [],
		defaultTasks: [],
		activeTaskId: null,
		activeKind: null,
		gate: idleGate,
		model: 'default',
		modelDisplay: 'Default',
		modelCatalog: [],
		slashCatalog: [],
		slashCatalogHydrated: false,
		queue: [],
		queuePaused: false,
		transcript: [],
		approvals: [],
		questions: [],
		codeChanges: []
	};
}

test('pullTaskBodies deduplicates per Task without letting A absorb B', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
	let calls = 0;
	let resolve!: (value: TasksSnapshot) => void;
	const pending = new Promise<TasksSnapshot>(done => {
		resolve = done;
	});
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			fastIde: {
				listTasks: () => {
					calls += 1;
					return pending;
				}
			}
		}
	});

	try {
		const store = createWorkspaceStore();
		const bootstrap = pullTaskBodies(store, 'task-a');
		const sessionPane = pullTaskBodies(store, 'task-a');
		assert.equal(bootstrap, sessionPane);
		assert.equal(calls, 1);
		const taskB = pullTaskBodies(store, 'task-b');
		assert.notEqual(taskB, bootstrap);
		assert.equal(calls, 2);
		resolve(emptyTasks());
		await Promise.all([bootstrap, sessionPane, taskB]);

		const later = pullTaskBodies(store, 'task-a');
		assert.equal(calls, 3, 'completed pulls do not become a permanent cache');
		await later;
	} finally {
		if (previous) Object.defineProperty(globalThis, 'window', previous);
		else Reflect.deleteProperty(globalThis, 'window');
	}
});
