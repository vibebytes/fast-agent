/**
 * Push + invoke channel maps. InvokeChannels is the intersection of the domain halves.
 */
import type {CloudflareTunnelStatus, EdgesList} from './desktop.js';
import type {InvokeHost} from './invokeHost.js';
import type {InvokeOrg} from './invokeOrg.js';
import type {InvokeSession} from './invokeSession.js';
import type {
	BridgeErrorEnvelope,
	BridgeEventEnvelope,
	BridgeExitEnvelope,
	BridgeLogEnvelope,
	CompletionCue,
	ProjectState,
	ProjectsSnapshot,
	TasksMeta,
	TranscriptPatch,
	TranscriptTailPatch,
	WorkspaceFocus
} from './session.js';

export type PushChannels = {
	'projects:changed': ProjectsSnapshot;
	'workspace:focus': WorkspaceFocus;
	'project:changed': ProjectState;
	'tasks:changed': TasksMeta;
	'transcript:patched': TranscriptPatch;
	'transcript:tailPatched': TranscriptTailPatch;
	'bridge:event': BridgeEventEnvelope;
	'bridge:error': BridgeErrorEnvelope;
	'bridge:log': BridgeLogEnvelope;
	'bridge:exit': BridgeExitEnvelope;
	/** Cold-start landing gate: Meta applied; shell may mount. */
	'workspace:restored': Record<string, never>;
	/** Cold-start landing gate: timeout / spawn failure; shell mounts with Engine error. */
	'workspace:restoreFailed': {reason: string};
	/** Settings-center namespace changed (PatchSettings) — renderer invalidates useSettings. */
	'settings:changed': {scope: string; scopeId: string; namespace: string};
	/** Model provider row changed — renderer invalidates useProviders. */
	'providers:changed': {providerId: string};
	/** Skill package changed — renderer invalidates useSkills. */
	'skills:changed': {skillName: string};
	/** L0 engine sidecar install log line. */
	'engines:installLog': {engineId: string; stream: 'stdout' | 'stderr'; text: string; seq: number};
	/** Agent turn / Goal settled — renderer may play the completion chime. */
	'completion:cue': CompletionCue;
	/** Remote edge catalog / active / pending changed. */
	'edges:changed': EdgesList;
	/** Cloudflare Tunnel 状态变更（主进程 push，§cloudflare-tunnel-pairing.md §4.5.2）。 */
	'cloudflareTunnel:changed': CloudflareTunnelStatus;
};

export type InvokeDesktop = InvokeHost & InvokeOrg;

export type InvokeChannels = InvokeSession & InvokeDesktop;

export type {DshSkillsResult} from './invokeSession.js';

export type PushChannel = keyof PushChannels;
export type InvokeChannel = keyof InvokeChannels;

export type UiSend = <C extends PushChannel>(channel: C, payload: PushChannels[C]) => void;

export type InvokeArgs<C extends InvokeChannel> = InvokeChannels[C]['args'];
export type InvokeResult<C extends InvokeChannel> = InvokeChannels[C]['result'];
