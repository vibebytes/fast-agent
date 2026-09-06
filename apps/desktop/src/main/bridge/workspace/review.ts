import type {BridgeCommand} from '@fastllm/bridge-protocol';
import type {
	FileReviewDiff,
	ReviewChangeDetail,
	ReviewDiffSnapshot,
	ReviewList,
	ReviewPreview,
	ReviewRefusal,
	ReviewRestored
} from '@fast-ide/session-view';
import type {BridgeEvent} from '@fastllm/bridge-protocol';
import type {HostLane} from './hostWait.js';

type ReviewPayload = NonNullable<Extract<BridgeEvent, {type: 'command_result'}>['review']>;

const RestoreWaitMs = 60_000;

export type ReviewLane = HostLane & {
	ensureSlot: (
		projectId: string
	) => Promise<{ok: true; hash: string} | {ok: false; notice: string}>;
};

export type WorkspaceReview = {
	listReviewChanges: (
		projectId: string,
		checkpointId?: string | null,
		sessionId?: string | null
	) => Promise<{ok: true; list: ReviewList} | ReviewRefusal>;
	getReviewChange: (
		projectId: string,
		changeId: string
	) => Promise<{ok: true; change: ReviewChangeDetail} | ReviewRefusal>;
	listReviewDiff: (
		projectId: string,
		sinceRevision?: number
	) => Promise<{ok: true; diff: ReviewDiffSnapshot} | ReviewRefusal>;
	getFileReviewDiff: (
		projectId: string,
		path: string
	) => Promise<{ok: true; file: FileReviewDiff} | ReviewRefusal>;
	keepReviewChanges: (
		projectId: string,
		changeIds: string[],
		revision: number
	) => Promise<{ok: true} | ReviewRefusal>;
	previewRevert: (
		projectId: string,
		input: {
			target: 'timeline' | 'whole' | 'pending' | 'changes';
			revision: number;
			checkpointId?: string;
			changeIds?: string[];
		}
	) => Promise<{ok: true; preview: ReviewPreview} | ReviewRefusal>;
	applyRevert: (
		projectId: string,
		previewId: string,
		force?: boolean
	) => Promise<{ok: true; restored: ReviewRestored} | ReviewRefusal>;
	redoRevert: (
		projectId: string,
		restoreId: string
	) => Promise<{ok: true; restored: ReviewRestored} | ReviewRefusal>;
};

export function createReview(lane: ReviewLane): WorkspaceReview {
	const tails = new Map<string, Promise<void>>();

	const reviewOp = (
		projectId: string,
		name: string,
		command: (hash: string) => BridgeCommand,
		timeoutMs?: number
	): Promise<{ok: true; review: ReviewPayload} | ReviewRefusal> => {
		const run = (tails.get(projectId) ?? Promise.resolve()).then(
			() => sendReview(projectId, name, command, timeoutMs),
			() => sendReview(projectId, name, command, timeoutMs)
		);
		tails.set(
			projectId,
			run.then(
				() => undefined,
				() => undefined
			)
		);
		return run;
	};

	const sendReview = async (
		projectId: string,
		name: string,
		command: (hash: string) => BridgeCommand,
		timeoutMs?: number
	): Promise<{ok: true; review: ReviewPayload} | ReviewRefusal> => {
		const slot = await lane.ensureSlot(projectId);
		if (!slot.ok) return slot;
		const {token, promise} = lane.wait([name], undefined, timeoutMs, projectId);
		if (!lane.send(command(slot.hash))) {
			lane.cancel(token);
			return {ok: false, notice: `Failed to send ${name}`};
		}
		try {
			const event = await promise;
			const review = (event.review ?? {}) as ReviewPayload;
			if (event.status === 'unavailable' || review.available === false) {
				return {ok: false, notice: event.message, unavailable: true};
			}
			if (event.status === 'error' || event.status === 'rejected') {
				return {
					ok: false,
					notice: event.message,
					revision: review.revision,
					conflicts: review.conflicts,
					movedPaths: review.movedPaths,
					expired: review.expired
				};
			}
			return {ok: true, review};
		} catch (e) {
			return {ok: false, notice: e instanceof Error ? e.message : String(e)};
		}
	};

	const restoring = async (
		projectId: string,
		name: 'ApplyRevert' | 'RedoRevert',
		command: (hash: string) => BridgeCommand
	): Promise<{ok: true; restored: ReviewRestored} | ReviewRefusal> => {
		const answer = await reviewOp(projectId, name, command, RestoreWaitMs);
		if (!answer.ok) return answer;
		const restored = answer.review.restored;
		return restored
			? {ok: true, restored: {restoreId: restored.restoreId, revision: restored.revision}}
			: {ok: false, notice: 'Engine reported no restore'};
	};

	return {
		listReviewChanges(projectId, checkpointId, sessionId) {
			return reviewOp(projectId, 'ListReviewChanges', hash => ({
				type: 'ListReviewChanges',
				workspaceId: hash,
				...(checkpointId ? {checkpointId} : {}),
				...(sessionId ? {sessionId} : {})
			})).then(answer =>
				answer.ok
					? {
							ok: true as const,
							list: {
								revision: answer.review.revision ?? 0,
								changes: (answer.review.changes ?? []) as ReviewList['changes'],
								available: answer.review.available !== false,
								checkpoints: (answer.review.checkpoints ?? []) as ReviewList['checkpoints']
							}
						}
					: answer
			);
		},
		async getReviewChange(projectId, changeId) {
			const answer = await reviewOp(projectId, 'GetReviewChange', hash => ({
				type: 'GetReviewChange',
				workspaceId: hash,
				changeId
			}));
			if (!answer.ok) return answer;
			const change = answer.review.change as ReviewChangeDetail | null | undefined;
			return change ? {ok: true, change} : {ok: false, notice: 'Change no longer in the review list'};
		},
		async listReviewDiff(projectId, sinceRevision) {
			const answer = await reviewOp(projectId, 'ListReviewDiff', hash => ({
				type: 'ListReviewDiff',
				workspaceId: hash,
				...(sinceRevision !== undefined ? {sinceRevision} : {})
			}));
			if (!answer.ok) return answer;
			const diff = answer.review.diff as ReviewDiffSnapshot | null | undefined;
			return diff
				? {ok: true, diff}
				: {ok: false, notice: 'The review diff is not available for this checkout'};
		},
		async getFileReviewDiff(projectId, path) {
			const answer = await reviewOp(projectId, 'GetFileReviewDiff', hash => ({
				type: 'GetFileReviewDiff',
				workspaceId: hash,
				path
			}));
			if (!answer.ok) return answer;
			const file = answer.review.file as FileReviewDiff | null | undefined;
			return file ? {ok: true, file} : {ok: false, notice: 'No pending review diff for this file'};
		},
		async keepReviewChanges(projectId, changeIds, revision) {
			const answer = await reviewOp(projectId, 'KeepChanges', hash => ({
				type: 'KeepChanges',
				workspaceId: hash,
				changeIds,
				revision
			}));
			return answer.ok ? {ok: true} : answer;
		},
		async previewRevert(projectId, input) {
			const answer = await reviewOp(projectId, 'PreviewRevert', hash => ({
				type: 'PreviewRevert',
				workspaceId: hash,
				target: input.target,
				revision: input.revision,
				...(input.checkpointId ? {checkpointId: input.checkpointId} : {}),
				...(input.changeIds ? {changeIds: input.changeIds} : {})
			}));
			if (!answer.ok) return answer;
			const preview = answer.review.preview as ReviewPreview | undefined;
			return preview ? {ok: true, preview} : {ok: false, notice: 'Engine returned no undo plan'};
		},
		applyRevert(projectId, previewId, force) {
			return restoring(projectId, 'ApplyRevert', hash => ({
				type: 'ApplyRevert',
				workspaceId: hash,
				previewId,
				...(force ? {force: true} : {})
			}));
		},
		redoRevert(projectId, restoreId) {
			return restoring(projectId, 'RedoRevert', hash => ({
				type: 'RedoRevert',
				workspaceId: hash,
				restoreId
			}));
		}
	};
}
