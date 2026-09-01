import {existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';

const storePath = path.join(homedir(), '.fast', 'trusted-workspaces');

export function workspaceRoot(): string {
	return realpathSync.native(process.env.FAST_AGENT_ROOT ?? process.cwd());
}

export function isWorkspaceTrusted(workspace = workspaceRoot()): boolean {
	if (!existsSync(storePath)) {
		return false;
	}

	const realWorkspace = realpathSync.native(workspace);
	return readFileSync(storePath, 'utf8')
		.split(/\r?\n/)
		.some(line => line.trim() === realWorkspace);
}

export function trustWorkspace(workspace = workspaceRoot()): void {
	const realWorkspace = realpathSync.native(workspace);
	mkdirSync(path.dirname(storePath), {recursive: true});
	const existing = existsSync(storePath)
		? new Set(readFileSync(storePath, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean))
		: new Set<string>();

	if (!existing.has(realWorkspace)) {
		writeFileSync(storePath, `${realWorkspace}\n`, {encoding: 'utf8', flag: 'a'});
	}
}
