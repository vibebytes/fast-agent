import {mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

/** Packaged desktop keeps the engine at ~/.fast. Dev stays under userData so it does not touch that tree. */
export function applyRuntimeEnv(input: {
	env: NodeJS.ProcessEnv;
	userDataPath: string;
	resourcesPath?: string;
	isPackaged?: boolean;
	homeDir?: string;
	mkdir?: (path: string) => void;
}): void {
	const root = input.isPackaged
		? join(input.homeDir ?? homedir(), '.fast')
		: join(input.userDataPath, 'runtime');
	input.env.FAST_RUNTIME_ROOT ??= root;
	try {
		(input.mkdir ?? ((path: string) => mkdirSync(path, {recursive: true})))(join(root, 'conf'));
	} catch {
		// best effort — the agent reports a precise Io fault if the location is unwritable
	}
	if (input.isPackaged && input.resourcesPath) {
		input.env.FAST_ENGINES_YAML ??= join(input.resourcesPath, 'engine', 'conf', 'engines.yaml');
	}
}
