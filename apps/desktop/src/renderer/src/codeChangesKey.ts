import type {CodeChange} from './env';

/**
 * Content fingerprint for "agent wrote files" git-refresh triggering (perf doc P0-5).
 * Full `transcript:patched` payloads remake the codeChanges array reference every
 * coalesced frame; keying the effect on this string fires refreshGit only when a
 * change lands or settles — not per streaming tick.
 */
export function codeChangesKey(changes: readonly CodeChange[]): string {
	if (changes.length === 0) return '';
	const last = changes[changes.length - 1]!;
	return `${changes.length}|${last.id}:${last.status}`;
}
