import {z} from 'zod';

export type CatalogCommand =
	{
			/** Settings-center documents. scope=effective merges project over global. */
			type: 'GetSettings';
			scope: 'global' | 'project' | 'effective' | string;
			scopeId?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			/** RFC 7386 merge-patch one settings namespace; patchJson is the patch as a JSON string. */
			type: 'PatchSettings';
			scope: 'global' | 'project' | string;
			namespace: string;
			patchJson: string;
			scopeId?: string;
			schemaVersion?: number;
			tenantId?: string;
			appId?: string;
	  }
	| {
			/** Settings-center model providers. */
			type: 'ListProviders';
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'UpsertProvider';
			name: string;
			id?: string;
			presetKey?: string;
			baseUrl?: string;
			kind?: string;
			metaJson?: string;
			credential?: string;
			seedModelsJson?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'DeleteProvider';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'SetProviderEnabled';
			id: string;
			enabled: boolean;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'TestProvider';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'PatchProviderModels';
			id: string;
			patchJson: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'SearchProviderModels';
			id: string;
			query: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			/** Settings-center skills (disk SoT + market). */
			type: 'ListSkills';
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'CreateSkill';
			name: string;
			scope: string;
			template?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'DeleteSkill';
			name: string;
			scope: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'SetSkillEnabled';
			name: string;
			scope: string;
			enabled: boolean;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'SearchSkillMarket';
			query: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'InstallSkillFromMarket';
			source: string;
			scope: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'UninstallSkillFromMarket';
			name: string;
			scope: string;
			tenantId?: string;
			appId?: string;
	  }

export const catalogCommandSchemas = [
	z.object({
		type: z.literal('GetSettings'),
		scope: z.string(),
		scopeId: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('PatchSettings'),
		scope: z.string(),
		namespace: z.string(),
		patchJson: z.string(),
		scopeId: z.string().optional(),
		schemaVersion: z.number().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListProviders'),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UpsertProvider'),
		name: z.string(),
		id: z.string().optional(),
		presetKey: z.string().optional(),
		baseUrl: z.string().optional(),
		kind: z.string().optional(),
		metaJson: z.string().optional(),
		credential: z.string().optional(),
		seedModelsJson: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('DeleteProvider'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SetProviderEnabled'),
		id: z.string(),
		enabled: z.boolean(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('TestProvider'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('PatchProviderModels'),
		id: z.string(),
		patchJson: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SearchProviderModels'),
		id: z.string(),
		query: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListSkills'),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('CreateSkill'),
		name: z.string(),
		scope: z.string(),
		template: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('DeleteSkill'),
		name: z.string(),
		scope: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SetSkillEnabled'),
		name: z.string(),
		scope: z.string(),
		enabled: z.boolean(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SearchSkillMarket'),
		query: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('InstallSkillFromMarket'),
		source: z.string(),
		scope: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UninstallSkillFromMarket'),
		name: z.string(),
		scope: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	})
] as const

export const catalogEventSchemas = [
	z.object({
		/** A settings namespace changed (PatchSettings accepted) — peers re-read via GetSettings. */
		type: z.literal('settings_changed'),
		scope: z.string(),
		scopeId: z.string(),
		namespace: z.string()
	}),
	z.object({
		/** A model provider row changed — peers re-list via ListProviders. */
		type: z.literal('providers_changed'),
		providerId: z.string()
	}),
	z.object({
		/** A skill package changed — peers re-list via ListSkills. */
		type: z.literal('skills_changed'),
		skillName: z.string()
	})
] as const
