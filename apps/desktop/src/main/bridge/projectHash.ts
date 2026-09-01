import {createHash} from 'node:crypto';
import path from 'node:path';

/**
 * Matches quant/agent `Projects.projectHash`: SHA-256 of normalized absolute path,
 * first 6 bytes as hex (12 chars).
 */
export function projectHash(workspaceRoot: string): string {
	const normalized = path.resolve(workspaceRoot);
	const digest = createHash('sha256').update(normalized, 'utf8').digest();
	return digest.subarray(0, 6).toString('hex');
}
