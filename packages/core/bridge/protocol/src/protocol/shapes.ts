import {z} from 'zod';

export const stringRecord = z.record(z.string(), z.string());

export const commandInfo = z.object({
	name: z.string(),
	description: z.string().default(''),
	usage: z.string().optional().default(''),
	available: z.boolean().optional().default(true),
	availability: z.preprocess(
		value => value === 'capabilityunavailable' ? 'capability_unavailable' : value,
		z.enum(['ready', 'partial', 'capability_unavailable', 'hidden']).optional()
	),
	capability: z.preprocess(value => value === null ? undefined : value, z.string().optional()).optional(),
	/** Optional UI badge (e.g. skill scope: 个人 / 项目). */
	badge: z.string().optional()
});

export const questionOption = z.object({
	id: z.string(),
	label: z.string(),
	description: z.string().optional(),
	recommended: z.boolean().optional()
});

export const questionBatchOption = z.object({
	label: z.string(),
	description: z.string().optional()
});

export const questionBatchItem = z.object({
	id: z.string(),
	question: z.string(),
	detail: z.string().optional(),
	header: z.string().optional(),
	options: z.array(questionBatchOption).optional(),
	multiSelect: z.boolean().optional(),
	intent: z.object({kind: z.string(), approve: z.string()}).optional()
});

export const questionBatchAnswer = z.object({
	id: z.string(),
	selected: z.array(z.string()),
	custom: z.string().optional()
});

export const modelSettingsInfo = z.object({
	platform: z.string(),
	model: z.string(),
	effort: z.string().optional(),
	thinking: z.boolean().optional()
});

export const sessionInfo = z.object({
	id: z.string(),
	title: z.string().nullish(),
	summary: z.string().nullish(),
	lastModified: z.string(),
	messageCount: z.number(),
	cwd: z.string().nullish(),
	isCurrent: z.boolean().nullish(),
	/** Sticky session.run_mode for Composer Mode cold restore. */
	runMode: z.string().nullish(),
	/** Sticky session.engine_kind — `dsh` or omitted (Fast). */
	engineKind: z.string().nullish(),
	/** Sticky session.model_settings for Composer sampling cold restore. */
	modelSettings: modelSettingsInfo.nullish()
});

export const planTodo = z.object({
	id: z.string(),
	content: z.string().optional().default(''),
	status: z.enum(['pending', 'in_progress', 'completed']).or(z.string())
});
