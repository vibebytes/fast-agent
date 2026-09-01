/**
 * Line-oriented 3-way merge for editor conflicts.
 * Conflict markers stay in the Monaco buffer only — never write them to disk.
 */
export type Merge3Result =
	| {ok: true; text: string; clean: true}
	| {ok: true; text: string; clean: false};

export function merge3(base: string, ours: string, theirs: string): Merge3Result {
	if (ours === theirs) return {ok: true, text: ours, clean: true};
	if (ours === base) return {ok: true, text: theirs, clean: true};
	if (theirs === base) return {ok: true, text: ours, clean: true};

	const baseLines = splitLines(base);
	const ourLines = splitLines(ours);
	const theirLines = splitLines(theirs);

	// Same-length aligned pass — when lengths differ, fall back to a single conflict block.
	if (baseLines.length === ourLines.length && baseLines.length === theirLines.length) {
		const out: string[] = [];
		let clean = true;
		let i = 0;
		while (i < baseLines.length) {
			const b = baseLines[i]!;
			const o = ourLines[i]!;
			const t = theirLines[i]!;
			if (o === t) {
				out.push(o);
				i += 1;
				continue;
			}
			if (o === b) {
				out.push(t);
				i += 1;
				continue;
			}
			if (t === b) {
				out.push(o);
				i += 1;
				continue;
			}
			clean = false;
			const start = i;
			i += 1;
			while (i < baseLines.length) {
				const bb = baseLines[i]!;
				const oo = ourLines[i]!;
				const tt = theirLines[i]!;
				if (oo === tt || oo === bb || tt === bb) break;
				i += 1;
			}
			out.push('<<<<<<< Ours');
			out.push(...ourLines.slice(start, i));
			out.push('=======');
			out.push(...theirLines.slice(start, i));
			out.push('>>>>>>> Disk');
		}
		return {ok: true, text: out.join('\n'), clean};
	}

	return {
		ok: true,
		text: [
			'<<<<<<< Ours',
			ours,
			'=======',
			theirs,
			'>>>>>>> Disk'
		].join('\n'),
		clean: false
	};
}

function splitLines(text: string): string[] {
	if (text.length === 0) return [];
	return text.split(/\n/);
}

/** True when buffer still contains unresolved 3-way conflict markers. */
export function hasConflictMarkers(text: string): boolean {
	return (
		text.includes('<<<<<<<') && text.includes('=======') && text.includes('>>>>>>>')
	);
}

export type ConflictChoice = 'merge' | 'disk' | 'mine' | 'cancel';

export type CloseDirtyChoice = 'discard' | 'save' | 'cancel';
