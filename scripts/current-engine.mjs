import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const unixNames = ['fast-cli', 'fast', 'agent-cli'];
const batNames = ['fast-cli.bat', 'fast.bat', 'agent-cli.bat'];

function cliIn(dir) {
	for (const n of unixNames) {
		const p = join(dir, 'bin', n);
		if (existsSync(p)) return p;
	}
	for (const n of batNames) {
		const p = join(dir, 'bin', n);
		if (existsSync(p)) return p;
	}
}

/** Walk up from `start` for `modules/engine/current` with fast-cli (or alias). */
export function currentEngineDir(start = dirname(fileURLToPath(import.meta.url))) {
	let dir = start;
	for (let i = 0; i < 12; i++) {
		const cur = join(dir, 'modules', 'engine', 'current');
		if (cliIn(cur)) return cur;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
}

export function currentEngineCli(start) {
	const dir = currentEngineDir(start);
	if (!dir) return undefined;
	return cliIn(dir);
}
