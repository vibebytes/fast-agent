/** Human countdown for next_fire_at (drawer + ScheduledJobs pane). */
export function formatCountdown(nextFireAt: string | null | undefined, now: number): string {
	if (!nextFireAt) return '';
	const t = Date.parse(nextFireAt);
	if (Number.isNaN(t)) return '';
	const ms = t - now;
	if (ms <= 0) return 'due';
	const sec = Math.floor(ms / 1000);
	if (sec < 60) return `in ${sec}s`;
	const m = Math.floor(sec / 60);
	if (m < 60) return `in ${m}m`;
	return `in ${Math.floor(m / 60)}h ${m % 60}m`;
}
