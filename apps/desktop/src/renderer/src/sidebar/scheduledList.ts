/** Plan row clock: month/day and HH:mm in the job timezone. */
export function planFireLabel(
	iso: string | null | undefined,
	timeZone: string | null | undefined
): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	const zone = timeZone?.trim() || undefined;
	const month = new Intl.DateTimeFormat('en-US', {month: 'numeric', timeZone: zone}).format(d);
	const day = new Intl.DateTimeFormat('en-US', {day: 'numeric', timeZone: zone}).format(d);
	const hm = new Intl.DateTimeFormat('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone: zone
	}).format(d);
	return `${month}/${day} ${hm}`;
}

export function relativeLabel(
	iso: string | null | undefined,
	now: number,
	locale: string
): string {
	if (!iso) return '';
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return '';
	const rtf = new Intl.RelativeTimeFormat(locale, {numeric: 'auto'});
	const minutes = Math.round((t - now) / 60_000);
	if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
	const hours = Math.round(minutes / 60);
	if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
	return rtf.format(Math.round(hours / 24), 'day');
}

export const runPageSize = 20;

/** Page is 0-based. A list of 20 or fewer is a single page. */
export function runSlice<T>(rows: readonly T[], page: number): {rows: T[]; page: number; pages: number} {
	const pages = Math.max(1, Math.ceil(rows.length / runPageSize));
	const current = Math.min(Math.max(0, page), pages - 1);
	const start = current * runPageSize;
	return {rows: rows.slice(start, start + runPageSize), page: current, pages};
}

/** Workspace label on a plan row: engine name, open-project name, then folder basename. */
export function planPlace(job: {
	workspaceName?: string | null;
	projectDisplayName?: string | null;
	workspaceRoot?: string | null;
}): string {
	const named = job.workspaceName?.trim() || job.projectDisplayName?.trim();
	if (named) return named;
	const root = job.workspaceRoot?.trim();
	if (!root) return '';
	const parts = root.split(/[/\\]/).filter(Boolean);
	return parts[parts.length - 1] ?? '';
}

export function isRunInProgress(status: string): boolean {
	const s = status.trim().toLowerCase();
	return s === 'dispatching' || s === 'running';
}
