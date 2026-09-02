/** Packed engine identity (`<ver> <jre> <UTC ISO>` from `.fast-engine-id`). */

export function trimmedId(raw: string | undefined): string | undefined {
	const t = raw?.trim();
	return t ? t : undefined;
}

function isLoopbackBind(bind: string): boolean {
	return /^(127\.0\.0\.1|localhost|\[::1\])(?::|$)/i.test(bind);
}

function wsBindFromArgs(commandLine: string | undefined): string | undefined {
	if (!commandLine) return undefined;
	return commandLine.match(/--wss?\s+(\S+)/)?.[1];
}

/** Packed `…/engine/bin/fast-cli` → `…/engine`. Relative `./bin/agent-cli` is not a pack. */
export function engineRootFromCli(cli: string | undefined): string | undefined {
	const bin = cli?.trim();
	if (!bin) return undefined;
	const norm = bin.replace(/\\/g, '/');
	const m = norm.match(/^(.*)\/bin\/(?:fast-cli|fast|agent-cli)(?:\.bat)?$/i);
	const root = m?.[1];
	if (!root || root === '.' || root === '..') return undefined;
	return root;
}

/** True when the process listens on a non-loopback `--ws` / `--wss` or `FAST_BRIDGE_WS(S)`. */
export function isPublicWsBind(
	commandLine: string | undefined,
	env?: NodeJS.ProcessEnv
): boolean {
	const fromArg = wsBindFromArgs(commandLine);
	if (fromArg) return !isLoopbackBind(fromArg);
	const fromEnv = trimmedId(env?.FAST_BRIDGE_WS) ?? trimmedId(env?.FAST_BRIDGE_WSS);
	return Boolean(fromEnv && !isLoopbackBind(fromEnv));
}

/**
 * True when `ps` is our launcher or the `exec java` image from that tree
 * (`…/engine/jre/bin/java … CliApp engine … bridge`).
 */
export function commandOwnsCli(commandLine: string | undefined, cli: string | undefined): boolean {
	const line = commandLine?.trim();
	const bin = cli?.trim();
	if (!line || !bin) return false;
	if (line.includes(bin)) return true;
	const root = engineRootFromCli(bin);
	if (!root) return false;
	const lineNorm = line.replace(/\\/g, '/');
	if (!lineNorm.includes(root)) return false;
	return (
		line.includes('ai.fastllm.agent.cli.CliApp') &&
		line.includes('engine') &&
		line.includes('bridge')
	);
}

/**
 * Replace the live host only when identity disagrees.
 * Existence alone is not enough. Public `--ws 0.0.0.0` hosts are never replaced.
 */
export function shouldReplaceDaemon(input: {
	wantId?: string;
	haveId?: string;
	commandLine?: string;
	bundledCli?: string;
	env?: NodeJS.ProcessEnv;
}): boolean {
	if (isPublicWsBind(input.commandLine, input.env)) return false;
	const want = trimmedId(input.wantId);
	const have = trimmedId(input.haveId);
	if (want && have) return want !== have;
	return Boolean(want && !have && commandOwnsCli(input.commandLine, input.bundledCli));
}

/** Desktop quit stops only a host we spawned, our bundled CLI, or our pack stamp. */
export function shouldStopDaemonOnQuit(input: {
	remote: boolean;
	spawned: boolean;
	commandLine?: string;
	bundledCli?: string;
	wantId?: string;
	haveId?: string;
	env?: NodeJS.ProcessEnv;
}): boolean {
	if (input.remote) return false;
	if (isPublicWsBind(input.commandLine, input.env)) return false;
	if (input.spawned) return true;
	if (commandOwnsCli(input.commandLine, input.bundledCli)) return true;
	const want = trimmedId(input.wantId);
	const have = trimmedId(input.haveId);
	return Boolean(want && have && want === have);
}

export async function waitWhile(
	cond: () => boolean,
	opts: {
		timeoutMs: number;
		stepMs?: number;
		sleep?: (ms: number) => Promise<void>;
		now?: () => number;
	}
): Promise<boolean> {
	const sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
	const now = opts.now ?? Date.now;
	const step = opts.stepMs ?? 100;
	const deadline = now() + opts.timeoutMs;
	let live = cond();
	while (live && now() < deadline) {
		await sleep(step);
		live = cond();
	}
	return !live;
}
