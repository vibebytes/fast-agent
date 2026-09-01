import {mkdirSync} from 'node:fs';
import {join} from 'node:path';

/** Point agent-side runtime roots at userData so overlay/engines.yaml never resolve against cwd. */
export function applyRuntimeEnv(input: {
	env: NodeJS.ProcessEnv;
	userDataPath: string;
	resourcesPath?: string;
	isPackaged?: boolean;
	mkdir?: (path: string) => void;
}): void {
	const root = join(input.userDataPath, 'runtime');
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
