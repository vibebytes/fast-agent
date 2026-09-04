const ON = new Set(['1', 'true', 'on', 'yes']);

/** LAN engine wss is opt-in. `FAST_MOBILE_BRIDGE=1` enables it. */
export function mobileBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const raw = env.FAST_MOBILE_BRIDGE?.trim().toLowerCase();
	return !!raw && ON.has(raw);
}
