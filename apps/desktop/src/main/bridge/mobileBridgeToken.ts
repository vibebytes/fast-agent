import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {dirname, join} from 'node:path';

export const MOBILE_BRIDGE_TOKEN_FILE = 'mobile-bridge.token';

const OFF = new Set(['0', 'false', 'off', 'no']);

/** LAN mobile bridge is on by default. `FAST_MOBILE_BRIDGE=0` opts out. */
export function mobileBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const raw = env.FAST_MOBILE_BRIDGE?.trim().toLowerCase();
	return !raw || !OFF.has(raw);
}

export function resolveMobileBridgeToken(input: {
	env: NodeJS.ProcessEnv;
	userDataPath: string;
}): string {
	const fromEnv = input.env.FAST_MOBILE_BRIDGE_TOKEN?.trim();
	if (fromEnv) return fromEnv;
	const path = join(input.userDataPath, MOBILE_BRIDGE_TOKEN_FILE);
	if (existsSync(path)) {
		const stored = readFileSync(path, 'utf8').trim();
		if (stored) return stored;
	}
	const token = randomBytes(24).toString('base64url');
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
	writeFileSync(path, `${token}\n`, {mode: 0o600});
	try {
		chmodSync(path, 0o600);
	} catch (error) {
		console.error(`could not set 0600 on ${path}`, error);
	}
	return token;
}
