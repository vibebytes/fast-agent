/**
 * Stable pastel tones for Tab Group chrome — distinct from bare Open Tabs
 * and from each other (keyed by groupKey).
 */
export type TabGroupTone = {
	/** Expanded / collapsed group shell. */
	shell: string;
	/** Group label text. */
	label: string;
	/** Soft hover on the expand control. */
	labelHover: string;
};

const TONES: TabGroupTone[] = [
	{
		shell: 'border-sky-500/20 bg-sky-500/[0.03] dark:bg-sky-500/[0.05]',
		label: 'text-sky-700 dark:text-sky-300',
		labelHover: 'hover:bg-sky-500/10'
	},
	{
		shell: 'border-teal-500/20 bg-teal-500/[0.03] dark:bg-teal-500/[0.05]',
		label: 'text-teal-700 dark:text-teal-300',
		labelHover: 'hover:bg-teal-500/10'
	},
	{
		shell: 'border-amber-500/20 bg-amber-500/[0.03] dark:bg-amber-500/[0.05]',
		label: 'text-amber-700 dark:text-amber-300',
		labelHover: 'hover:bg-amber-500/10'
	},
	{
		shell: 'border-rose-500/20 bg-rose-500/[0.03] dark:bg-rose-500/[0.05]',
		label: 'text-rose-700 dark:text-rose-300',
		labelHover: 'hover:bg-rose-500/10'
	},
	{
		shell: 'border-emerald-500/20 bg-emerald-500/[0.03] dark:bg-emerald-500/[0.05]',
		label: 'text-emerald-700 dark:text-emerald-300',
		labelHover: 'hover:bg-emerald-500/10'
	},
	{
		shell: 'border-indigo-500/20 bg-indigo-500/[0.03] dark:bg-indigo-500/[0.05]',
		label: 'text-indigo-700 dark:text-indigo-300',
		labelHover: 'hover:bg-indigo-500/10'
	}
];

function hashGroupKey(groupKey: string): number {
	let h = 2166136261;
	for (let i = 0; i < groupKey.length; i++) {
		h ^= groupKey.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

export function tabGroupTone(groupKey: string): TabGroupTone {
	return TONES[hashGroupKey(groupKey) % TONES.length]!;
}
