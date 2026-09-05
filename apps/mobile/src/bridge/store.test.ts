import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

test('testConnection awaits the probe so finally cannot steal the native socket', () => {
	const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'store.ts'), 'utf8');
	assert.match(src, /return await this\.testPinned\(/);
	assert.match(src, /return await this\.testPlain\(/);
});
