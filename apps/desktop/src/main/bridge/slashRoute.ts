/**
 * Re-export Thin Client slash gate from bridge-protocol (single source of truth).
 * Prefer importing from `@fastllm/bridge-protocol` directly in new code.
 */
export {
	isSkillSlashName,
	parseSlashInput,
	resolveSlashRoute,
	type SlashRoute
} from '@fastllm/bridge-protocol';
