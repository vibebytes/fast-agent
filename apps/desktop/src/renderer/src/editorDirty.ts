/** Monaco may rewrite CRLF to LF on load — that is not a user edit. */
export function sameEditorText(a: string, b: string): boolean {
	return a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
}

/**
 * Dirty baseline for an uncontrolled editor. Programmatic writes (disk reload, conflict merge)
 * become the new baseline, so the shared onChange channel does not misread a reload as a user edit
 * and wrongly mark a clean tab dirty (which later surfaces as a spurious close/save conflict).
 */
export class EditorDirtyBaseline {
	private base: string;

	constructor(seed: string) {
		this.base = seed;
	}

	/** Programmatic setValue: the written content is the new baseline. */
	programmatic(next: string): void {
		this.base = next;
	}

	/** Follow the external seed (defaultValue/baseContent) on render. */
	sync(seed: string): void {
		this.base = seed;
	}

	/** onChange: only a divergence from the baseline is a user edit. */
	isUserEdit(text: string): boolean {
		return !sameEditorText(text, this.base);
	}
}
