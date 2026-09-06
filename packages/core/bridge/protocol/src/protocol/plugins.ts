import {z} from 'zod';

export type PluginCommand =
	{
			type: 'ListExtensions';
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'ExtensionStatus';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'InstallExtension';
			dir: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'UninstallExtension';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'ListEngines';
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'EnableEngine';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'DisableEngine';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'StartEngine';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'StopEngine';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'SetDefaultEngine';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'InstallEngine';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'UninstallEngine';
			id: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'CancelEngineInstall';
			id: string;
			tenantId?: string;
			appId?: string;
	  }

export const pluginCommandSchemas = [
	z.object({
		type: z.literal('ListExtensions'),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ExtensionStatus'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('InstallExtension'),
		dir: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UninstallExtension'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('ListEngines'),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('EnableEngine'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('DisableEngine'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('StartEngine'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('StopEngine'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SetDefaultEngine'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('InstallEngine'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UninstallEngine'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('CancelEngineInstall'),
		id: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	})
] as const

export const pluginEventSchemas = [
	z.object({type: z.literal('engine_status'), stage: z.string(), message: z.string()}),
	z.object({
		type: z.literal('engine_install_log'),
		engineId: z.string(),
		stream: z.enum(['stdout', 'stderr']),
		text: z.string(),
		seq: z.number()
	})
] as const
