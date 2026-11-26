export type DiffRevealEditor = {
	revealFirstDiff: () => void;
	onDidUpdateDiff: (listener: () => void) => unknown;
};

export function revealFirstDiffWhenReady(editor: DiffRevealEditor): void {
	editor.revealFirstDiff();
	let revealed = false;
	editor.onDidUpdateDiff(() => {
		if (revealed) return;
		revealed = true;
		editor.revealFirstDiff();
	});
}
