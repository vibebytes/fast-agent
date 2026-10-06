import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const dir = dirname(fileURLToPath(import.meta.url));

test('main session mounts a foreign rail beside the owner river', () => {
	const pane = readFileSync(join(dir, 'SessionPane.tsx'), 'utf8');
	assert.match(pane, /splitForeignColumns/);
	assert.match(pane, /<ForeignRail/);
	assert.match(pane, /foreignItems/);
	const rail = readFileSync(join(dir, 'ForeignRail.tsx'), 'utf8');
	assert.match(rail, /data-slot="foreign-rail"/);
	assert.match(rail, /session\.foreign\.rail/);
});
