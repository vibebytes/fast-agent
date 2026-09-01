/**
 * fast-ink UI harness boundaries — UI must NOT cross these lines.
 * Scala engine owns execution, policy, prompt assembly, and task lifecycle.
 */
import {engineCommandNames, uiOnlyCommandNames} from '../commands/commandSpec.js';

export const UI_BOUNDARIES = {
	mustNotExecuteTools: true,
	mustNotAssemblePrompts: true,
	mustNotEnforcePolicy: true,
	mustNotSimulateTaskEntity: true,
	mustNotParseScalaCaseClasses: true,
	mustNotBypassApproval: true
} as const;

/** Bridge commands the UI is allowed to send. */
export const ALLOWED_BRIDGE_COMMANDS = [
	'AttachSession',
	'DetachSession',
	'SubmitUserMessage',
	'command',
	'CancelRun',
	'CancelSession',
	'AnswerQuestion',
	'DecideApproval',
	'Ack',
	'Heartbeat',
	'CreateSession',
	'GetWorkspaceMeta',
	'SetSessionTitle',
	'SetSessionSummary',
	'UpdateSessionStatus',
	'SetProjectDisplayName'
] as const;

/** UI-only slash commands — never forwarded as engine command. */
export const UI_ONLY_COMMANDS = uiOnlyCommandNames() as readonly string[];

/** Engine commands — forwarded to Scala bridge via {type:'command'}. */
export const ENGINE_COMMANDS = engineCommandNames() as readonly string[];

export type AllowedBridgeCommand = (typeof ALLOWED_BRIDGE_COMMANDS)[number];
export type UiOnlyCommand = ReturnType<typeof uiOnlyCommandNames>[number];
export type EngineCommand = ReturnType<typeof engineCommandNames>[number];
