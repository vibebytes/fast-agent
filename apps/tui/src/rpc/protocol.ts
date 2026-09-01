/**
 * Thin re-export — Bridge protocol lives in `@fastllm/bridge-protocol`
 * so Fast IDE and other clients share one contract with the Engine.
 * Keep in sync via the shared package (Hello / EnsureProject / HelloOk / …).
 */
export type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';
export {bridgeEventSchema, bridgeCommandSchema, parseBridgeCommand} from '@fastllm/bridge-protocol';
