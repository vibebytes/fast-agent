export type SessionLaunchConfig = {
	mode: 'new' | 'continue' | 'resume';
	sessionId?: string;
};

export type MetaSessionRow = {
	id: string;
	status: string;
	updatedAt?: string | null;
};

/** Map CLI argv / env onto SessionLaunchConfig for unix EnsureProject boot. */
export function resolveInkSessionConfig(
	argv: string[] = process.argv.slice(2),
	env: NodeJS.ProcessEnv = process.env
): SessionLaunchConfig {
	if (argv.includes('--new') || argv.includes('-n') || env.FAST_SESSION === 'new') {
		return {mode: 'new'};
	}
	const resumeIdx = argv.indexOf('--resume');
	if (resumeIdx >= 0 && argv[resumeIdx + 1]) {
		return {mode: 'resume', sessionId: argv[resumeIdx + 1]};
	}
	if (env.FAST_RESUME?.trim()) {
		return {mode: 'resume', sessionId: env.FAST_RESUME.trim()};
	}
	return {mode: 'continue'};
}

/**
 * Pick the newest non-deleted/closed session for EnsureProject continue.
 * Spec §9.1: default continue latest; none → caller CreateSession.
 */
export function latestActiveSession(sessions: MetaSessionRow[]): MetaSessionRow | undefined {
	const active = sessions.filter(s => s.status !== 'deleted' && s.status !== 'closed');
	return active
		.slice()
		.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0];
}

export function resolveSessionArgs(config?: SessionLaunchConfig, argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): string[] {
	if (config?.mode === 'new') return ['--new'];
	if (config?.mode === 'resume' && config.sessionId) return ['--resume', config.sessionId];

	if (argv.includes('--new') || argv.includes('-n') || env.FAST_SESSION === 'new') {
		return ['--new'];
	}
	const resumeIdx = argv.indexOf('--resume');
	if (resumeIdx >= 0 && argv[resumeIdx + 1]) {
		return ['--resume', argv[resumeIdx + 1]!];
	}
	if (env.FAST_RESUME) {
		return ['--resume', env.FAST_RESUME];
	}
	// Default: always auto-continue the latest session
	return ['--continue'];
}
