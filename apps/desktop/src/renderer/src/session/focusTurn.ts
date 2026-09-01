import {turnIdMatches} from './focusTurnId';

/** Scroll transcript to a turn/run id (matches data-turn-id / timeline item id). */
export function focusTranscriptTurn(runId: string | null | undefined): boolean {
	const id = runId?.trim();
	if (!id) return false;
	const exact = document.querySelector(`[data-turn-id="${CSS.escape(id)}"]`);
	const el =
		exact instanceof HTMLElement
			? exact
			: Array.from(document.querySelectorAll<HTMLElement>('[data-turn-id]')).find(node =>
					turnIdMatches(node.getAttribute('data-turn-id') ?? '', id)
				);
	if (!el) return false;
	el.scrollIntoView({behavior: 'smooth', block: 'center'});
	el.classList.add('ring-1', 'ring-foreground/40');
	window.setTimeout(() => el.classList.remove('ring-1', 'ring-foreground/40'), 1600);
	return true;
}

/** Open session then focus turn (platform jobs / cross-session). */
export async function openSessionTurn(
	sessionId: string | null | undefined,
	runId: string | null | undefined
): Promise<void> {
	const sid = sessionId?.trim();
	if (sid) await window.fastIde.selectTask(sid);
	if (!runId?.trim()) return;
	for (const delay of [0, 120, 350, 800]) {
		await new Promise(r => window.setTimeout(r, delay));
		if (focusTranscriptTurn(runId)) return;
	}
}
