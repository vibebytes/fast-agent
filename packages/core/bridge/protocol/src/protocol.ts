import {z} from 'zod';
import {eventMeta, refineRiver} from './protocol/river.js';
import {type HostCommand, hostCommandSchemas, hostEventSchemas} from './protocol/host.js';
import {type CatalogCommand, catalogCommandSchemas, catalogEventSchemas} from './protocol/catalog.js';
import {type PluginCommand, pluginCommandSchemas, pluginEventSchemas} from './protocol/plugins.js';
import {type OrgCommand, orgCommandSchemas} from './protocol/org.js';
import {type CheckoutCommand, checkoutCommandSchemas, checkoutEventSchemas} from './protocol/checkout.js';
import {type SessionCmd, sessionCmdSchemas, sessionCmdEventSchemas} from './protocol/sessionCmd.js';
import {sessionLiveSchemas} from './protocol/sessionLive.js';
import {sessionSettleSchemas} from './protocol/sessionSettle.js';
import {
	type SessionRestoreCommand,
	sessionRestoreCommandSchemas,
	sessionRestoreSchemas
} from './protocol/sessionRestore.js';
import {commandResultSchema} from './protocol/commandResult.js';

export {pickIdList, wireIdList} from './protocol/ids.js';
export {isLiveChrome, PERSIST_RIVER_TYPES} from './protocol/river.js';

export type BridgeCommand =
	| SessionCmd
	| SessionRestoreCommand
	| HostCommand
	| CatalogCommand
	| PluginCommand
	| OrgCommand
	| CheckoutCommand;

const commandSchemas = [
	...sessionCmdSchemas,
	...sessionRestoreCommandSchemas,
	...hostCommandSchemas,
	...catalogCommandSchemas,
	...pluginCommandSchemas,
	...orgCommandSchemas,
	...checkoutCommandSchemas
] as const;

const eventSchemas = [
	...hostEventSchemas,
	...catalogEventSchemas,
	...pluginEventSchemas,
	...checkoutEventSchemas,
	...sessionCmdEventSchemas,
	...sessionLiveSchemas,
	...sessionSettleSchemas,
	...sessionRestoreSchemas,
	commandResultSchema
] as const;

export const bridgeCommandSchema = z.discriminatedUnion(
	'type',
	commandSchemas as unknown as [
		(typeof commandSchemas)[0],
		(typeof commandSchemas)[1],
		...typeof commandSchemas
	]
);
export const bridgeEventPayloadSchema = z.discriminatedUnion(
	'type',
	eventSchemas as unknown as [
		(typeof eventSchemas)[0],
		(typeof eventSchemas)[1],
		...typeof eventSchemas
	]
);
export const bridgeEventSchema = bridgeEventPayloadSchema.and(eventMeta).superRefine((ev, ctx) => {
	refineRiver(ev as {type: string; eventSeq?: number} & Record<string, unknown>, ctx);
});
export type BridgeEvent = z.infer<typeof bridgeEventSchema>;

export function parseBridgeCommand(input: unknown): BridgeCommand {
	return bridgeCommandSchema.parse(input) as BridgeCommand;
}
