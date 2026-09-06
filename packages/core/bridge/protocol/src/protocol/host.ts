import {z} from 'zod';
import {sessionInfo} from './shapes.js';

export type HostCommand =
	{type: 'RegisterWorkspace'; path: string}
	| {type: 'UnregisterWorkspace'; workspaceId: string}
	/** @deprecated Engine rejects; use GetWorkspaceMeta */
	| {type: 'GetOpenProjectSet'; defaultPath?: string}
	/** @deprecated Engine rejects; use CreateProject / UpdateProjectStatus */
	| {type: 'SetOpenProjectSet'; openPaths: string[]; activePath?: string; defaultPath?: string}
	| {type: 'GetWorkspaceMeta'; tenantId?: string; appId?: string}
	| {
			type: 'CreateProject';
			projectType: string;
			rootPath?: string;
			displayName?: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'UpdateProjectStatus';
			projectId: string;
			status: string;
			tenantId?: string;
			appId?: string;
	  }
	| {
			type: 'SetProjectDisplayName';
			projectId: string;
			displayName: string;
			tenantId?: string;
			appId?: string;
	  }
	/** Idempotent folder Project + RegisterWorkspace (cli-ink cwd sharing). */
	| {
			type: 'EnsureProject';
			path: string;
			displayName?: string;
			projectType?: string;
			tenantId?: string;
			appId?: string;
	  }
	/** Connection handshake (required on unix/npipe before other commands). */
	| {
			type: 'Hello';
			protocolVersion: number;
			clientId: string;
			clientKind: 'fast-ide' | 'fast-ink' | string;
			clientVersion?: string;
			pid?: number;
			cwd?: string;
			authToken?: string;
	  }
	| {type: 'Goodbye'; clientId: string; reason?: string}
	/** Connection-level heartbeat (lease refresh without Attach). */
	| {type: 'ClientHeartbeat'; clientId: string; atMillis?: number}
	| {type: 'GetDaemonStatus'}
	| {type: 'GetBridgePairing'}
	| {type: 'SetLanPairing'; enabled: boolean}
	| {type: 'Shutdown'; force?: boolean}

export const hostCommandSchemas = [
	z.object({type: z.literal('RegisterWorkspace'), path: z.string()}),
	z.object({type: z.literal('UnregisterWorkspace'), workspaceId: z.string()}),
	z.object({type: z.literal('GetOpenProjectSet'), defaultPath: z.string().optional()}),
	z.object({
		type: z.literal('SetOpenProjectSet'),
		openPaths: z.array(z.string()),
		activePath: z.string().optional(),
		defaultPath: z.string().optional()
	}),
	z.object({
		type: z.literal('GetWorkspaceMeta'),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('CreateProject'),
		projectType: z.string(),
		rootPath: z.string().optional(),
		displayName: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('UpdateProjectStatus'),
		projectId: z.string(),
		status: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('SetProjectDisplayName'),
		projectId: z.string(),
		displayName: z.string(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('EnsureProject'),
		path: z.string(),
		displayName: z.string().optional(),
		projectType: z.string().optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	}),
	z.object({
		type: z.literal('Hello'),
		protocolVersion: z.number(),
		clientId: z.string(),
		clientKind: z.string(),
		clientVersion: z.string().optional(),
		pid: z.number().optional(),
		cwd: z.string().optional(),
		authToken: z.string().optional()
	}),
	z.object({
		type: z.literal('Goodbye'),
		clientId: z.string(),
		reason: z.string().optional()
	}),
	z.object({
		type: z.literal('ClientHeartbeat'),
		clientId: z.string(),
		atMillis: z.number().optional()
	}),
	z.object({type: z.literal('GetDaemonStatus')}),
	z.object({type: z.literal('GetBridgePairing')}),
	z.object({
		type: z.literal('SetLanPairing'),
		enabled: z.boolean()
	}),
	z.object({
		type: z.literal('Shutdown'),
		force: z.boolean().optional()
	})
] as const

export const hostEventSchemas = [
	z.object({
		type: z.literal('ready'),
		protocolVersion: z.number().optional(),
		engineEpoch: z.string().optional(),
		capabilities: z.array(z.string()).optional(),
		model: z.string().optional(),
		modelDisplay: z.string().optional(),
		maxTurns: z.number().optional(),
		standalone: z.boolean().optional(),
		cwd: z.string().optional(),
		mode: z.string().optional(),
		sessionId: z.string().optional(),
		sessionTitle: z.string().optional(),
		restoredMessageCount: z.number().optional(),
		adminUrl: z.string().optional(),
		/**
		 * Whether agent changes in this daemon can be reviewed and undone at all. `available: false`
		 * means the drawer must say so instead of offering undo affordances that cannot work.
		 * Absent from daemons older than the checkpoint feature.
		 */
		checkpoint: z.object({backend: z.string(), available: z.boolean()}).optional()
	}),
	z.object({type: z.literal('host_error'), message: z.string()}),
	z.object({
		type: z.literal('sessions_list'),
		sessions: z.array(sessionInfo)
	}),
	z.object({
		/** @deprecated Engine open-set authority removed; prefer workspace_meta */
		type: z.literal('open_project_set'),
		openPaths: z.array(z.string()),
		activePath: z.string().nullish(),
		defaultPath: z.string()
	}),
	z.object({
		type: z.literal('workspace_meta'),
		tenantId: z.string(),
		appId: z.string(),
		projects: z.array(z.object({
			id: z.string(),
			projectType: z.string(),
			displayName: z.string().nullish(),
			status: z.string(),
			isDefault: z.boolean(),
			settings: z.string().nullish(),
			workspace: z.object({
				id: z.string(),
				placement: z.string(),
				rootPath: z.string().nullish(),
				pathHash: z.string().nullish(),
				label: z.string().nullish()
			}).nullish()
		})),
		sessionsByProjectId: z.record(z.string(), z.array(z.object({
			id: z.string(),
			title: z.string().nullish(),
			status: z.string(),
			updatedAt: z.string().nullish(),
			workspaceId: z.string().nullish(),
			startupMode: z.string().nullish()
		})))
	}),
	z.object({
		type: z.literal('HelloOk'),
		protocolVersion: z.number().optional(),
		engineEpoch: z.string().optional(),
		daemonPid: z.number().optional(),
		serverTimeMillis: z.number().optional(),
		hostHome: z.string().optional(),
		/** Packed `.fast-engine-id` (`<ver> <jre> <UTC>`). Absent on hand-started hosts. */
		engineId: z.string().optional()
	}),
	z.object({
		type: z.literal('HelloReject'),
		code: z.enum(['VERSION_MISMATCH', 'UNAUTHORIZED', 'ENGINE_BUSY', 'INTERNAL']).or(z.string()),
		message: z.string().optional()
	}),
	z.object({
		type: z.literal('daemon_shutting_down'),
		reason: z.string().optional()
	})
] as const
