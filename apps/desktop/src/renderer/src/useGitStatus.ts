import {useCallback, useEffect, useState} from 'react';
import type {GitStatus} from '@fast-ide/session-view';

/**
 * Git status chrome (perf doc P2-14, extracted from App): 12s poll + window
 * focus + code-change fingerprint trigger. Main process holds the TTL /
 * in-flight merge (P0-5); this hook only owns the renderer trigger policy.
 */
export function useGitStatus(
	projectPath: string | null,
	codeChangesRefreshKey: string
): {gitStatus: GitStatus | null; refreshGitForce: () => void} {
	const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);

	const refreshGit = useCallback(
		async (opts?: {force?: boolean}) => {
			if (!projectPath) {
				setGitStatus(null);
				return;
			}
			if (typeof window.fastIde.gitStatus !== 'function') return;
			// Fire-and-forget vs tree: never await from FilesPane mount path.
			const next = await window.fastIde.gitStatus(opts?.force);
			setGitStatus(next);
		},
		[projectPath]
	);

	useEffect(() => {
		if (!projectPath) {
			setGitStatus(null);
			return;
		}
		// Defer so root listDir paints before the first git probe (non-git dirs
		// used to re-probe on every project.status tick and feel like retries).
		const boot = window.setTimeout(() => void refreshGit(), 0);
		const timer = window.setInterval(() => void refreshGit(), 12_000);
		const onFocus = () => void refreshGit();
		window.addEventListener('focus', onFocus);
		return () => {
			window.clearTimeout(boot);
			window.clearInterval(timer);
			window.removeEventListener('focus', onFocus);
		};
	}, [refreshGit, projectPath]);

	// Agent code changes are a practical stand-in for "files were written".
	// Keyed by content fingerprint, not array identity (P0-5).
	useEffect(() => {
		if (!codeChangesRefreshKey) return;
		void refreshGit();
	}, [codeChangesRefreshKey, refreshGit]);

	const refreshGitForce = useCallback(() => void refreshGit({force: true}), [refreshGit]);

	return {gitStatus, refreshGitForce};
}
