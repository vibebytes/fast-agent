/**
 * Paste triage for the rich composer — plain text or real file attachments only.
 * Rich flavors (text/html, rtf) and pathless blobs (screenshots) never reach the editable.
 */

export type PastePlan =
	| {mode: 'text'; text: string}
	| {mode: 'files'; files: File[]}
	| {mode: 'ignore'};

/** Files win over text; only the `text/plain` flavor is ever read. */
export function planPaste(dt: Pick<DataTransfer, 'files' | 'getData'> | null): PastePlan {
	if (!dt) return {mode: 'ignore'};
	const files = Array.from(dt.files);
	if (files.length > 0) return {mode: 'files', files};
	const text = dt.getData('text/plain');
	return text ? {mode: 'text', text} : {mode: 'ignore'};
}
