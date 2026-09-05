/**
 * Turn identity (CONTEXT.md → TurnIdentity).
 *
 * The only place that answers "does this id identify this Turn/Run":
 * wire WorkId normalization (`run:` prefix), cross-id turn matching
 * (turnId ↔ clientMessageId, either side), the input_accepted remap
 * verdict, and id-shape verdicts for synthetic Goal/scheduler turns.
 */

export type TurnKey = {turnId?: string; clientMessageId?: string};

/** Bare form of a wire WorkId (`run:<uuid>` → `<uuid>`). */
export function bareRunId(id: string | undefined): string {
	return id === undefined ? '' : id.startsWith('run:') ? id.slice(4) : id;
}

export function sameRunId(a: string | undefined, b: string | undefined): boolean {
	return a !== undefined && b !== undefined && bareRunId(a) === bareRunId(b);
}

/**
 * Two turn keys identify the same Turn when any key of one equals any key
 * of the other (turnId↔turnId, turnId↔clientMessageId, both directions).
 */
export function sameTurn(a: TurnKey, b: TurnKey): boolean {
	if (a.turnId && (a.turnId === b.turnId || a.turnId === b.clientMessageId)) return true;
	if (
		a.clientMessageId &&
		(a.clientMessageId === b.turnId || a.clientMessageId === b.clientMessageId)
	)
		return true;
	return false;
}

/** `id` matches the entry's turnId or clientMessageId. */
export function entryMatchesKey(entry: TurnKey, id: string | undefined): boolean {
	return id !== undefined && id !== '' && (entry.turnId === id || entry.clientMessageId === id);
}

/** The entry's turnId specifically (narrower than entryMatchesKey). */
export function entryTurnIdIs(entry: TurnKey, id: string | undefined): boolean {
	return id !== undefined && id !== '' && entry.turnId === id;
}

/**
 * input_accepted remap verdict: the engine accepted a client turn and
 * issued a server run id. Only a pair of distinct ids remaps.
 */
export function serverRunIdOf(event: TurnKey): string | undefined {
	return event.turnId && event.clientMessageId && event.turnId !== event.clientMessageId
		? event.turnId
		: undefined;
}

/** Goal notice / step conclusion turns never own chat chrome. */
export function isGoalNoticeId(id: string | undefined): boolean {
	if (!id) return false;
	return /^goal-.+-notice$/.test(id) || /^goal-step-.+-conclusion$/.test(id);
}

/** Scheduler-generated client turn ids. */
export function isScheduledId(id: string | undefined): boolean {
	return id !== undefined && id.startsWith('sched-');
}
