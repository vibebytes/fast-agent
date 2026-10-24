/** What the tab chrome should show for one `ui://` app: the page, or why there is no page.
 *
 * `offline` outranks a failed read: a server that left the catalog cannot serve the next call
 * either, so saying "offline" is more useful than the last transport error.
 */
export type AppCardState =
	| {kind: 'open'}
	| {kind: 'blocked'; notice: string}
	| {kind: 'offline'; server: string};

export type AppCardInput = {
	/** `pending` while the first `mcpAppRead` is in flight — nothing to show yet, so it counts as open. */
	read: 'pending' | 'ok' | 'failed';
	notice?: string | null;
	/** `null` until the catalog has answered once; a list nobody fetched must not close a live tab. */
	live: boolean | null;
	server: string;
};

export function appCardState(input: AppCardInput): AppCardState {
	if (input.live === false) return {kind: 'offline', server: input.server};
	if (input.read !== 'failed') return {kind: 'open'};
	const notice = (input.notice ?? '').trim();
	return {kind: 'blocked', notice: notice || `${input.server} could not be opened`};
}
