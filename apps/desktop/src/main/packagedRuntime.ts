import {existsSync, readFileSync} from 'node:fs';
import {delimiter, join} from 'node:path';
import {engineBinName} from '@fastllm/bridge-client';

/** Packaged Desktop: point Bridge at extraResources and put shims on PATH. */
export function applyPackagedRuntime(input: {
	isPackaged: boolean;
	resourcesPath: string;
	env: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	existsSync?: (p: string) => boolean;
	readFileSync?: (p: string, enc: BufferEncoding) => string;
}): void {
	if (!input.isPackaged) return;
	const exists = input.existsSync ?? existsSync;
	const read = input.readFileSync ?? readFileSync;
	const platform = input.platform ?? process.platform;
	input.env.ELECTRON_RESOURCES_PATH ??= input.resourcesPath;
	const cli = join(input.resourcesPath, 'engine', 'bin', engineBinName(platform));
	if (exists(cli)) input.env.FAST_BUNDLED_ENGINE ??= cli;
	const idFile = join(input.resourcesPath, 'engine', '.fast-engine-id');
	if (exists(idFile)) {
		const id = read(idFile, 'utf8').trim();
		if (id) input.env.FAST_WANT_ENGINE_ID = id;
	}
	const jre = join(input.resourcesPath, 'engine', 'jre');
	if (exists(jre)) {
		input.env.JAVA_HOME = jre;
		input.env.PATH = `${join(jre, 'bin')}${delimiter}${input.env.PATH ?? ''}`;
	}
	const bin = join(input.resourcesPath, 'bin');
	if (exists(bin)) {
		input.env.PATH = `${bin}${delimiter}${input.env.PATH ?? ''}`;
	}
}
