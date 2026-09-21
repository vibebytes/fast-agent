/** WorkspaceHub tests — shared FakeBridge kit. Loaded by domain files. */
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {BridgeClient} from '../BridgeClient.js';
import {projectHash} from '../projectHash.js';
import type {BridgeCommand, BridgeEvent} from '@fastllm/bridge-protocol';

export type FakeBridge = BridgeClient & {
	__child: EventEmitter & {killed: boolean; stdout: PassThrough};
	__inject: (event: BridgeEvent) => void;
	/** Flush held CreateSession/NewSession auto-acks (only when holdCreateSession). */
	__releaseCreates: () => void;
	/** Flush held RegisterWorkspace auto-acks (only when holdRegister). */
	__releaseRegisters: () => void;
};

/** Settings-enabled models fixture — Composer must match this, not yaml Anthropic. */
const SETTINGS_ENABLED_PROVIDERS = [
	{
		id: 'deepseek',
		kind: 'api',
		vendor: 'deepseek',
		name: 'DeepSeek',
		modelCount: 2,
		enabledModelCount: 2,
		enabled: true,
		models: [
			{
				modelId: 'deepseek-v4-flash',
				displayName: 'DeepSeek V4 Flash',
				enabled: true,
				source: 'catalog'
			},
			{
				modelId: 'deepseek-v4-pro',
				displayName: 'DeepSeek V4 Pro',
				enabled: true,
				source: 'catalog'
			}
		]
	},
	{
		id: 'openrouter',
		kind: 'api',
		vendor: 'openrouter',
		name: 'OpenRouter',
		modelCount: 2,
		enabledModelCount: 2,
		enabled: true,
		models: [
			{
				modelId: 'openai/gpt-5.6-terra',
				displayName: 'GPT-5.6 Terra',
				enabled: true,
				source: 'catalog'
			},
			{
				modelId: 'openrouter/free',
				displayName: 'OpenRouter Free',
				enabled: true,
				source: 'catalog'
			}
		]
	},
	{
		id: 'zhipu',
		kind: 'api',
		vendor: 'zhipu',
		name: 'Zhipu',
		modelCount: 1,
		enabledModelCount: 1,
		enabled: true,
		models: [
			{modelId: 'glm-5.2', displayName: 'GLM-5.2', enabled: true, source: 'catalog'}
		]
	},
	{
		id: 'anthropic',
		kind: 'api',
		vendor: 'anthropic',
		name: 'Anthropic',
		modelCount: 1,
		enabledModelCount: 1,
		enabled: false,
		models: [
			{
				modelId: 'claude-opus-4-5',
				displayName: 'Claude Opus 4.5',
				enabled: true,
				source: 'catalog'
			}
		]
	}
];

export function createFakeBridge(
	commands: BridgeCommand[],
	opts: {
		onStop?: () => void;
		/**
		 * Record CreateSession/NewSession but do not auto-ack until `__releaseCreates()`.
		 * Used to reproduce CreateProject/Register `retryPendingNew` races.
		 */
		holdCreateSession?: boolean;
		/**
		 * Record RegisterWorkspace/CreateProject but do not auto-ack until `__releaseRegisters()`.
		 * Used to reproduce review ops racing a still-unregistered workspace.
		 */
		holdRegister?: boolean;
		/** ListProviders reply. `error` = fail; omit uses Settings-enabled fixture. */
		listProviders?: typeof SETTINGS_ENABLED_PROVIDERS | 'error';
		/** Delay ListProviders command_result (ms). Used to assert catalog refresh awaits the reply. */
		listProvidersDelayMs?: number;
	} = {}
): FakeBridge {
	const heldCreates: Array<() => void> = [];
	const heldRegisters: Array<() => void> = [];
	const stdout = new PassThrough();
	const stdin = new PassThrough();
	const stderr = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		stdout,
		stderr,
		stdin,
		killed: false,
		pid: 1,
		kill(this: EventEmitter & {killed: boolean}) {
			this.killed = true;
			this.emit('exit', 0, null);
		}
	});

	const client = new BridgeClient({
		spawnImpl: () => child as never
	}) as FakeBridge;

	const origStart = client.start.bind(client);
	client.start = ((workspaceRoot, handlers, launchOptions = {}) => {
		origStart(workspaceRoot, handlers, {
			...launchOptions,
			env: {
				FAST_ENGINE_COMMAND: 'mock',
				FAST_ENGINE_ARGS: 'engine --mode bridge --transport stdio --new',
				...(launchOptions.env ?? {})
			},
			bundledEnginePath: '/unused',
			sessionMode: 'new'
		});
		queueMicrotask(() => {
			stdout.write(
				`${JSON.stringify({
			type: 'ready',
			protocolVersion: 2,
					sessionId: 'host-sess',
					cwd: workspaceRoot,
			mode: 'bridge'
				})}\n`
			);
		});
	}) as BridgeClient['start'];

	const origSend = client.send.bind(client);
	client.send = ((cmd: BridgeCommand) => {
		commands.push(cmd);
		const ok = origSend(cmd);
		if (cmd.type === 'RegisterWorkspace') {
			const emitRegisterAck = () => {
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'RegisterWorkspace',
						message: projectHash(cmd.path),
						status: 'accepted'
					})}\n`
				);
			};
			if (opts.holdRegister) {
				heldRegisters.push(emitRegisterAck);
			} else {
				queueMicrotask(emitRegisterAck);
			}
		}
		if (cmd.type === 'CreateSession' || cmd.type === 'NewSession') {
			const emitCreateAck = () => {
				const sessionId = `sess-${commands.filter(c => c.type === 'CreateSession' || c.type === 'NewSession').length}`;
				const projectId =
					cmd.type === 'CreateSession' ? cmd.projectId : 'default-project';
				// Production adoptCreatedSession returns path-hash; Thin Client (taskId)
				// skips session-switch ready and Attaches next.
				const workspaceId = cmd.workspaceId;
				const taskId =
					cmd.type === 'CreateSession' || cmd.type === 'NewSession'
						? cmd.taskId
						: undefined;
				if (!taskId) {
					stdout.write(
						`${JSON.stringify({
							type: 'ready',
							protocolVersion: 2,
							sessionId,
							cwd: workspaceId ?? 'default',
							mode: 'bridge'
						})}\n`
					);
				}
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: cmd.type,
						message: `Started session ${sessionId.slice(0, 8)}.`,
						status: 'accepted',
						sessionId,
						projectId,
						workspaceId,
						taskId
					})}\n`
				);
			};
			if (opts.holdCreateSession) {
				heldCreates.push(emitCreateAck);
			} else {
				queueMicrotask(emitCreateAck);
			}
		}
		if (cmd.type === 'CreateProject') {
			queueMicrotask(() => {
				const projectId = `proj-${commands.filter(c => c.type === 'CreateProject').length}`;
				const hash = cmd.rootPath ? projectHash(cmd.rootPath) : undefined;
				const emit = () =>
					stdout.write(
						`${JSON.stringify({
							type: 'command_result',
							name: 'CreateProject',
							message: `created ${projectId}`,
							status: 'accepted',
							projectId,
							workspaceId: `meta-ws-${projectId}`,
							pathHash: hash
						})}\n`
					);
				if (opts.holdRegister) heldRegisters.push(emit);
				else emit();
			});
		}
		if (cmd.type === 'GetWorkspaceMeta') {
			queueMicrotask(() => {
				stdout.write(
					`${JSON.stringify({
						type: 'workspace_meta',
						tenantId: 'default',
						appId: 'default-app',
						projects: [
							{
								id: 'default-project',
								projectType: 'general',
								displayName: 'Default Project',
								status: 'active',
								isDefault: true,
								workspace: null
							}
						],
						sessionsByProjectId: {}
					})}\n`
				);
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'GetWorkspaceMeta',
						message: '1 projects',
						status: 'accepted'
					})}\n`
				);
			});
		}
		if (cmd.type === 'UpdateProjectStatus') {
			queueMicrotask(() => {
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'UpdateProjectStatus',
						message: cmd.status,
						status: 'accepted',
						projectId: cmd.projectId
					})}\n`
				);
			});
		}
		if (cmd.type === 'SetProjectDisplayName') {
			queueMicrotask(() => {
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'SetProjectDisplayName',
						message: `DisplayName -> "${cmd.displayName}"`,
						status: 'accepted',
						projectId: cmd.projectId,
						displayName: cmd.displayName
					})}\n`
				);
			});
		}
		if (cmd.type === 'ListProviders') {
			const reply = () => {
				if (opts.listProviders === 'error') {
					stdout.write(
						`${JSON.stringify({
							type: 'command_result',
							name: 'ListProviders',
							message: 'engine unavailable',
							status: 'error'
						})}\n`
					);
					return;
				}
				const providers = opts.listProviders ?? SETTINGS_ENABLED_PROVIDERS;
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'ListProviders',
						message: `${providers.length} providers`,
						status: 'accepted',
						providers
					})}\n`
				);
			};
			const delayMs = opts.listProvidersDelayMs ?? 0;
			if (delayMs > 0) setTimeout(reply, delayMs);
			else queueMicrotask(reply);
		}
		if (cmd.type === 'SaveWorkspaceFile') {
			// leave to caller inject for FS tests
		}
		if (cmd.type === 'GitWorkspaceStatus') {
			queueMicrotask(() => {
				stdout.write(
					`${JSON.stringify({
						type: 'command_result',
						name: 'GitWorkspaceStatus',
						message: 'branch=main files=1',
						status: 'success',
						requestId: cmd.requestId,
						pathHash: cmd.workspaceId,
						git: {
							available: true,
							branch: 'main',
							dirty: true,
							files: [{path: 'a.txt', kind: 'modified'}]
						}
					})}\n`
				);
			});
		}
		return ok;
	}) as BridgeClient['send'];

	const origStop = client.stop.bind(client);
	client.stop = (() => {
		opts.onStop?.();
		origStop();
		child.killed = true;
	}) as BridgeClient['stop'];

	client.__child = child as FakeBridge['__child'];
	client.__inject = (event: BridgeEvent) => {
		stdout.write(`${JSON.stringify(event)}\n`);
	};
	client.__releaseCreates = () => {
		const pending = heldCreates.splice(0, heldCreates.length);
		for (const emit of pending) emit();
	};
	client.__releaseRegisters = () => {
		const pending = heldRegisters.splice(0, heldRegisters.length);
		for (const emit of pending) emit();
	};
	return client;
}

export function noopHandlers() {
	return {
		onEvent: () => {},
		onError: () => {},
		onExit: () => {}
	};
}

export function engineRow(
	id: string,
	patch: Partial<{
		kind: 'builtin' | 'extension';
		adapter: 'ready' | 'disabled' | 'failed';
		program: 'builtin' | 'installed' | 'missing' | 'installing';
		process: 'none' | 'stopped' | 'running';
		inRegistry: boolean;
		isDefault: boolean;
		actions: string[];
	}> = {}
) {
	return {
		id,
		kind: id === 'fast' ? ('builtin' as const) : ('extension' as const),
		adapter: 'ready' as const,
		program: id === 'fast' ? ('builtin' as const) : ('installed' as const),
		process: id === 'fast' ? ('none' as const) : ('stopped' as const),
		isDefault: id === 'fast',
		inRegistry: id === 'fast',
		actions: [] as string[],
		...patch
	};
}

/** First-ready ListEngines waiter must be settled before a test issues its own list. */
export async function settleReadyEngines(bridge: FakeBridge | null, commands: BridgeCommand[]): Promise<void> {
	await new Promise(r => setTimeout(r, 80));
	if (!bridge || !commands.some(c => c.type === 'ListEngines')) return;
	bridge.__inject({
		type: 'command_result',
		name: 'ListEngines',
		message: '1 engine',
		status: 'accepted',
		engines: [engineRow('fast', {inRegistry: true})]
	});
	await new Promise(r => setTimeout(r, 20));
}
