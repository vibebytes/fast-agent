import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const fastRoot = join(here, '../../../../../');

const consumers = [
	['Desktop', 'apps/desktop/src/main/bridge/sessionStreamEvents.ts'],
	['Mobile', 'apps/mobile/src/bridge/store.ts'],
	['TUI', 'apps/tui/src/state/reducer.ts']
] as const;

test('Desktop / Mobile / TUI import session stream from @fastllm/bridge-protocol', () => {
	for (const [label, rel] of consumers) {
		const src = readFileSync(join(fastRoot, rel), 'utf8');
		assert.match(
			src,
			/from '@fastllm\/bridge-protocol'/,
			`${label} must import from @fastllm/bridge-protocol`
		);
		assert.match(
			src,
			/\bisSessionStreamEvent\b/,
			`${label} must consume isSessionStreamEvent`
		);
	}
});
