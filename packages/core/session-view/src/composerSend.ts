import type {BridgeCommand} from '@fastllm/bridge-protocol';
import {isSkillSlashName} from '@fastllm/bridge-protocol';
import {planBuildDisplayContent} from './plan.js';
import type {MentionChip} from './wire.js';

export type ComposerTaskLike = {
	id: string;
	sessionId: string | null;
	autoTitlePending: boolean;
	model: string | null;
	modelDisplay: string | null;
};

export type ComposerSampling = {useModel?: string; effort?: string; thinking?: boolean};

export type ComposerSendDeps<T extends ComposerTaskLike> = {
	createId: () => string;
	now: () => number;
	send: (cmd: BridgeCommand) => boolean;
	getActiveTask: () => T | null;
	commandSessionId: () => string | undefined;
	canSubmitNow: () => boolean;
	canSubmitCommand: () => boolean;
	describeSendBlocker: () => string;
	engineKind: () => 'fast' | 'dsh';
	promptLine: (name: string, args?: string) => string;
	selectModel: (id: string) => boolean;
	requestModelList: () => boolean;
	setHelpNotice: (notice: string) => void;
	applyRunMode: (mode: 'agent' | 'plan' | 'ask' | 'yolo') => void;
	effort: () => string | undefined;
	onClearSlash: () => boolean;
	touchLastModified: (task: T) => void;
	useModelOf: (model: string | null, modelDisplay: string | null) => string | null | undefined;
	catalogHas: (ref: string | null) => boolean;
	submitThinking: () => boolean | undefined;
	titleGenRequested: Set<string>;
	seedHostSlashCatalog: () => boolean;
	slashCatalogLive: () => boolean;
	applyEmptySlashCatalog: () => void;
	markSlashCatalogHydrated: () => void;
	appendSkillsTranscript: (message: string) => void;
};

/**
 * Composer send channel: SubmitUserMessage sampling, slash interpretation,
 * pinned Bridge `command` and the silent `/skills` catalog FIFO.
 */
export function createComposerSend<T extends ComposerTaskLike>(deps: ComposerSendDeps<T>) {
	let openModelPicker = false;
	let pendingPlanBuildPlanId: string | null = null;
	const skillsResultMode: Array<'silent' | 'transcript'> = [];
	let silentSkillsInFlight = 0;
	let silentSkillsStartedAt = 0;

	const composerSampling = (): ComposerSampling => {
		const task = deps.getActiveTask();
		if (!task) return {};
		const useModel =
			deps.useModelOf(task.model, task.modelDisplay) ??
			(task.model && deps.catalogHas(task.model) ? task.model.trim() : undefined) ??
			(task.modelDisplay && deps.catalogHas(task.modelDisplay) ? task.modelDisplay.trim() : undefined);
		const thinking = deps.submitThinking();
		return {
			...(useModel ? {useModel} : {}),
			...(deps.effort() ? {effort: deps.effort()} : {}),
			...(thinking !== undefined ? {thinking} : {})
		};
	};

	const submitUserText = (
		trimmed: string,
		mentions?: MentionChip[],
		planBuild?: {planId: string; name?: string}
	): boolean => {
		const task = deps.getActiveTask();
		if (!task?.sessionId) return false;
		const generateTitle = task.autoTitlePending;
		const sessionId = task.sessionId;
		const sampling = composerSampling();
		const ok = deps.send({
			type: 'SubmitUserMessage',
			sessionId,
			clientMessageId: deps.createId(),
			text:
				trimmed ||
				(planBuild ? planBuildDisplayContent(planBuild.name ?? '', planBuild.planId) : ''),
			...sampling,
			...(planBuild ? {mode: 'agent'} : {}),
			...(generateTitle ? {generateTitle: true} : {}),
			...(mentions && mentions.length > 0 ? {mentions} : {}),
			...(planBuild
				? {planBuild: {planId: planBuild.planId, ...(planBuild.name ? {name: planBuild.name} : {})}}
				: {})
		} as BridgeCommand);
		if (ok && generateTitle) deps.titleGenRequested.add(sessionId);
		if (ok && planBuild) pendingPlanBuildPlanId = planBuild.planId;
		if (ok) deps.touchLastModified(task);
		return ok;
	};

	const sendPinnedCommand = (
		name: string,
		args: string,
		sessionId: string,
		opts?: {skillsTranscript?: boolean; generateTitle?: boolean}
	): boolean => {
		const cmd: BridgeCommand = {
			type: 'command',
			name,
			args,
			sessionId,
			...(opts?.generateTitle ? {generateTitle: true} : {})
		};
		if (!(cmd.type === 'command' && typeof cmd.sessionId === 'string' && cmd.sessionId.trim())) {
			deps.setHelpNotice('errors.send.skill_session_not_ready');
			return false;
		}
		const ok = deps.send(cmd);
		if (!ok) {
			deps.setHelpNotice('errors.send.bridge_not_ready');
			return false;
		}
		if (name.toLowerCase() === 'plan') deps.applyRunMode('plan');
		if (opts?.generateTitle) deps.titleGenRequested.add(sessionId);
		if (opts?.skillsTranscript) skillsResultMode.push('transcript');
		const active = deps.getActiveTask();
		if (active?.sessionId === sessionId) deps.touchLastModified(active);
		return true;
	};

	const requestSlashCatalog = (): boolean => {
		const sessionId = deps.commandSessionId();
		if (!sessionId) return false;
		deps.seedHostSlashCatalog();
		const staleMs = 5_000;
		if (silentSkillsInFlight > 0) {
			if (deps.now() - silentSkillsStartedAt < staleMs) return true;
			silentSkillsInFlight = 0;
			const orphan = skillsResultMode.indexOf('silent');
			if (orphan >= 0) skillsResultMode.splice(orphan, 1);
		}
		const ok = sendPinnedCommand('skills', '', sessionId);
		if (ok) {
			skillsResultMode.push('silent');
			silentSkillsInFlight += 1;
			silentSkillsStartedAt = deps.now();
		}
		return ok;
	};

	const handleSkillsResult = (event: {message?: string}): void => {
		const mode = skillsResultMode.shift() ?? 'silent';
		if (mode === 'silent') silentSkillsInFlight = Math.max(0, silentSkillsInFlight - 1);
		if (!deps.slashCatalogLive()) deps.applyEmptySlashCatalog();
		deps.markSlashCatalogHydrated();
		if (mode !== 'silent' && event.message?.trim()) deps.appendSkillsTranscript(event.message);
	};

	const takeOpenModelPicker = (): boolean => {
		const v = openModelPicker;
		openModelPicker = false;
		return v;
	};

	const clearPendingPlanBuild = (): void => {
		pendingPlanBuildPlanId = null;
	};

	const resetComposerState = (): void => {
		skillsResultMode.length = 0;
		silentSkillsInFlight = 0;
		silentSkillsStartedAt = 0;
		openModelPicker = false;
	};

	return {
		composerSampling,
		submitUserText,
		sendPinnedCommand,
		requestSlashCatalog,
		handleSkillsResult,
		takeOpenModelPicker,
		clearPendingPlanBuild,
		resetComposerState,
		get silentSkillsInFlight() {
			return silentSkillsInFlight;
		},
		get pendingPlanBuildPlanId() {
			return pendingPlanBuildPlanId;
		},
		handleSlash: (raw: string): boolean => {
			const body = raw.slice(1).trim();
			const space = body.search(/\s/);
			const name = (space < 0 ? body : body.slice(0, space)).toLowerCase();
			const args = space < 0 ? '' : body.slice(space + 1).trim();
			if (!name) {
				deps.setHelpNotice('errors.send.slash_empty');
				return false;
			}
			if (name === 'help') {
				deps.setHelpNotice('errors.send.slash_help');
				return true;
			}
			if (name === 'clear') return deps.onClearSlash();
			if (name === 'model') {
				if (deps.engineKind() === 'dsh') return true;
				if (args) return deps.selectModel(args);
				openModelPicker = true;
				return deps.requestModelList();
			}
			if (deps.engineKind() === 'dsh' && (name === 'mode' || isSkillSlashName(name))) {
				if (!deps.canSubmitNow()) {
					deps.setHelpNotice(deps.describeSendBlocker());
					return false;
				}
				return submitUserText(deps.promptLine(name, args));
			}
			if (!deps.canSubmitCommand()) {
				deps.setHelpNotice(deps.describeSendBlocker());
				return false;
			}
			const task = deps.getActiveTask();
			if (!task?.sessionId) {
				deps.setHelpNotice('errors.send.skill_session_not_ready');
				return false;
			}
			const generateTitle = isSkillSlashName(name) && task.autoTitlePending;
			return sendPinnedCommand(name, args, task.sessionId, {
				skillsTranscript: name === 'skills',
				generateTitle
			});
		}
	};
}
