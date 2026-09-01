import os from 'node:os';
import path from 'node:path';

/** Run-dir discovery matching Scala `BridgePaths`. */
export type BridgePaths = {
	runDir: string;
	socketPath: string;
	pidFile: string;
	tokenFile: string;
	logDir: string;
};

export function bridgePaths(env: NodeJS.ProcessEnv = process.env): BridgePaths {
	const home = env.HOME ?? env.USERPROFILE ?? os.homedir();
	const runDir = env.FAST_RUN_DIR?.trim() || path.join(home, '.fast', 'run');
	const socketPath = env.FAST_BRIDGE_SOCK?.trim() || path.join(runDir, 'bridge.sock');
	return {
		runDir,
		socketPath,
		pidFile: path.join(runDir, 'bridge.pid'),
		tokenFile: path.join(runDir, 'bridge.token'),
		logDir: path.join(home, '.fast', 'logs')
	};
}

export function isStdioTransport(env: NodeJS.ProcessEnv = process.env): boolean {
	// Spec §12.2 names FAST_ENGINE_TRANSPORT; implementation also accepts FAST_BRIDGE_TRANSPORT.
	const explicit = (env.FAST_BRIDGE_TRANSPORT ?? env.FAST_ENGINE_TRANSPORT ?? '').trim().toLowerCase();
	return explicit === 'stdio';
}
