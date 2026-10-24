import {z} from 'zod';

/**
 * Host → engine token mint for one panel instance. `extId` disambiguates a surface id that is
 * only unique per extension; `toolScope` is a request the engine clamps to `provides.tools`.
 */
export type SurfaceCommand = {
	type: 'MintSurfaceToken';
	extId?: string;
	surfaceId: string;
	instanceKey: string;
	sessionId?: string;
	toolScope?: string[];
};

export const surfaceCommandSchemas = [
	z.object({
		type: z.literal('MintSurfaceToken'),
		extId: z.string().optional(),
		surfaceId: z.string(),
		instanceKey: z.string(),
		sessionId: z.string().optional(),
		toolScope: z.array(z.string()).optional(),
		tenantId: z.string().optional(),
		appId: z.string().optional()
	})
] as const;

/**
 * Extension surface events. An extension publishes `ext.<extId>.surface.open`; the engine
 * re-publishes it on the host topic `SurfaceOpen` with the owning extension id injected, and the
 * bridge renames it to `surface_open` so the renderer can create a panel tab. Tabs are renderer
 * state — these events carry intent only, never a lifecycle command.
 */
export const surfaceEventSchemas = [
	z.object({
		type: z.literal('surface_open'),
		extId: z.string(),
		surfaceId: z.string(),
		instanceKey: z.string().optional(),
		url: z.string(),
		roomId: z.string().optional(),
		title: z.string().optional()
	}),
	z.object({
		type: z.literal('surface_state'),
		extId: z.string(),
		surfaceId: z.string(),
		state: z.enum(['unknown', 'ready', 'down', 'error']),
		detail: z.string().optional()
	})
] as const;
