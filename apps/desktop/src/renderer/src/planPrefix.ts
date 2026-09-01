/** Composer A2: visible `/plan ` prefix sync (mirrors Scala PlanPrefix). */

export const PLAN_MARKER = '/plan';

export function ensurePlanPrefix(text: string): string {
	const trimmedStart = text.replace(/^\s+/, '');
	const lower = trimmedStart.toLowerCase();
	if (
		lower === PLAN_MARKER ||
		lower.startsWith(`${PLAN_MARKER} `) ||
		lower.startsWith(`${PLAN_MARKER}\t`)
	) {
		return text;
	}
	if (!text) return `${PLAN_MARKER} `;
	return `${PLAN_MARKER} ${trimmedStart}`;
}

export function stripAutoPlanPrefix(text: string): string {
	if (text.toLowerCase() === PLAN_MARKER || text.toLowerCase() === `${PLAN_MARKER} `) return '';
	if (text.toLowerCase().startsWith(`${PLAN_MARKER} `) || text.toLowerCase().startsWith(`${PLAN_MARKER}\t`)) {
		return text.slice(PLAN_MARKER.length + 1);
	}
	return text;
}
