import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {appendHistoryEntry, loadHistory, normalizeHistory} from './inputHistory.js';

test('normalizeHistory trims empty lines and adjacent duplicates', () => {
	assert.deepEqual(normalizeHistory(['', ' ls ', 'ls', 'pwd', 'pwd', 'echo ok']), ['ls', 'pwd', 'echo ok']);
});

test('appendHistoryEntry persists new entries', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-history-'));
	const file = path.join(dir, 'history');

	let history = loadHistory(file);
	history = appendHistoryEntry(' npm test ', history, file);
	history = appendHistoryEntry('npm test', history, file);
	history = appendHistoryEntry('npm run build', history, file);

	assert.deepEqual(history, ['npm test', 'npm run build']);
	assert.deepEqual(loadHistory(file), ['npm test', 'npm run build']);
});
