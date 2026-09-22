import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {TaskBodySnapshot} from './env';
import {createWorkspaceStore} from './workspaceStore.js';
import {pullTaskBodies} from './workspaceWire.js';

test('pullTaskBodies deduplicates per Task without letting A absorb B', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
	let calls = 0;
	let resolve!: (value: TaskBodySnapshot | null) => void;
	const pending = new Promise<TaskBodySnapshot | null>(done => {
		resolve = done;
	});
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			fastIde: {
				taskBody: () => {
					calls += 1;
					return pending;
				},
				listTasks: () => {
					throw new Error('per-task pull must not list every task');
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
		resolve({
			taskId: 'task-a',
			entries: [],
			approvals: [],
			questions: [],
			codeChanges: []
		});
		await Promise.all([bootstrap, sessionPane, taskB]);

		const later = pullTaskBodies(store, 'task-a');
		assert.equal(calls, 3, 'completed pulls do not become a permanent cache');
		await later;
	} finally {
		if (previous) Object.defineProperty(globalThis, 'window', previous);
		else Reflect.deleteProperty(globalThis, 'window');
	}
});
