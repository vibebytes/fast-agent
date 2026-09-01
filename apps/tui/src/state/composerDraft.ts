/**
 * Process-wide signal: does the composer currently hold a non-empty draft?
 *
 * Written by Composer on every value change; read inside OTHER key handlers
 * (e.g. SubagentFooter) that must yield ←/→ to the text cursor while the
 * user is typing. Deliberately a module cell rather than React state:
 * readers only consult it inside input callbacks, so no re-render
 * subscription is needed and no context plumbing is added.
 */
let draftEmpty = true;

export function setComposerDraftEmpty(empty: boolean): void {
	draftEmpty = empty;
}

export function isComposerDraftEmpty(): boolean {
	return draftEmpty;
}
