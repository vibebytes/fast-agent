#!/usr/bin/env node
/** Minimal Bridge mock Engine: /new + Attach + tools/approvals/questions/cancel + review/undo. */
import {createInterface} from 'node:readline';
import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';

let eventSeq = 0;

const projectHash = workspaceRoot => {
	const digest = createHash('sha256').update(path.resolve(workspaceRoot), 'utf8').digest();
	return digest.subarray(0, 6).toString('hex');
};

/** Per-workspace review store: pending/kept/reverted change fixtures + undo previews/restores. */
const reviewStores = new Map();
const buildReviewStore = pathHash => {
	const changes = [
		{
			id: 'c-1',
			checkpointId: 'ck-1',
			path: 'src/a.ts',
			kind: 'modified',
			state: {kind: 'pending'},
			before: {id: 'b-1', text: 'const a = 1;'},
			after: {id: 'a-1', text: 'const a = 2;'},
			current: {id: 'cur-1', text: 'const a = 2;'}
		},
		{
			id: 'c-2',
			checkpointId: 'ck-1',
			path: 'notes.md',
			kind: 'added',
			state: {kind: 'pending'},
			before: null,
			after: {id: 'a-2', text: '# Notes'},
			current: {id: 'cur-2', text: '# Notes'}
		},
		{
			id: 'c-3',
			checkpointId: 'ck-1',
			path: 'binary.dat',
			kind: 'modified',
			state: {kind: 'pending'},
			before: {id: 'b-3', bytes: 4},
			after: {id: 'a-3', bytes: 5},
			current: {id: 'cur-3', omitted: 'missing'}
		}
	];
	const store = {
		pathHash,
		revision: 7,
		changes,
		checkpoints: [{id: 'ck-1', runId: 'run_1', messageId: 'msg_1', at: 1_700_000_000_000}],
		previews: new Map(),
		restores: new Map(),
		seq: 0
	};
	reviewStores.set(pathHash, store);
	return store;
};
const reviewStoreFor = cmd => {
	const hash = (cmd.workspaceId ?? '').replace(/^workspace:/, '');
	return reviewStores.get(hash) ?? buildReviewStore(hash || projectHash(cmd.pathHash ?? ''));
};
const reviewPayload = store => ({
	revision: store.revision,
	changes: store.changes,
	checkpoints: store.checkpoints,
	available: true
});
let currentSessionId = 'mock-session';
const knownSessions = new Set([currentSessionId]);
let turnCounter = 0;
let currentRunId = null;
let heldTurn = null;
const followUps = [];
/** runId → {text, failed} so RerunRun can replay the original message. */
const turnsByRun = new Map();

const emit = event => {
	eventSeq += 1;
	process.stdout.write(`${JSON.stringify({...event, eventSeq})}\n`);
};

const emitFollowUpChanged = () => {
	emit({
		type: 'follow_up_changed',
		paused: false,
		itemsJson: JSON.stringify(followUps),
		sessionId: currentSessionId
	});
};

const runTurn = (text, clientMessageId, opts = {}) => {
	turnCounter += 1;
	const turnId = `turn_${turnCounter}`;
	const runId = `run_${turnCounter}`;
	currentRunId = turnId;
	if (opts.ack !== false) {
		emit({type: 'input_accepted', turnId, clientMessageId, sessionId: currentSessionId});
	}
	emit({
		type: 'turn_started',
		turnId,
		clientMessageId,
		text,
		supersedes: opts.supersedes ?? null,
		supersedesFailed: opts.supersedesFailed ?? null,
		sessionId: currentSessionId
	});
	turnsByRun.set(runId, {text, failed: false});
	emit({type: 'tool_started', turnId, id: 'tool_1', tool: 'shell', args: {command: 'echo hi'}, sessionId: currentSessionId});
	emit({type: 'tool_output', turnId, id: 'tool_1', tool: 'shell', stream: 'stdout', text: 'hi\n', sessionId: currentSessionId});
	emit({type: 'tool_finished', turnId, id: 'tool_1', tool: 'shell', success: true, fields: {exit: '0'}, sessionId: currentSessionId});

	if (String(text).includes('fail-turn')) {
		turnsByRun.set(runId, {text, failed: true});
		emit({type: 'turn_finished', turnId, success: false, sessionId: currentSessionId});
		emit({
			type: 'run_failed',
			runId,
			error: 'RuntimeException: FaultCarrier: Declined: handshake timed out after10000ms (root cause: SslHandshakeTimeoutException)',
			sessionId: currentSessionId
		});
		currentRunId = null;
		return;
	}

	if (String(text).includes('need-approval')) {
		emit({
			type: 'approval_requested',
			runId,
			turnId,
			id: 'ap1',
			tool: 'shell',
			description: 'rm -rf /tmp/demo',
			risk: 'high',
			sessionId: currentSessionId
		});
		return;
	}
	if (String(text).includes('need-question')) {
		emit({
			type: 'question_requested',
			runId,
			turnId,
			id: 'q1',
			title: 'Target',
			question: 'Which environment?',
			options: [
				{id: 'dev', label: 'Development'},
				{id: 'prod', label: 'Production'}
			],
			allowCustom: true,
			sessionId: currentSessionId
		});
		return;
	}

	emit({type: 'reasoning_delta', turnId, text: 'Planning… ', sessionId: currentSessionId});
	emit({type: 'assistant_delta', turnId, text: `Echo: ${text}`, sessionId: currentSessionId});

	if (String(text).includes('longrun')) {
		heldTurn = {turnId, runId};
		return;
	}

	emit({type: 'final_answer', turnId, text: `Echo: ${text}`, sessionId: currentSessionId});
	emit({type: 'turn_finished', turnId, success: true, sessionId: currentSessionId});
	emit({type: 'run_done', runId, success: true, summary: 'echo', sessionId: currentSessionId});
	currentRunId = null;
};

emit({
	type: 'ready',
	protocolVersion: 2,
	engineEpoch: 'mock-epoch',
	capabilities: [],
	model: 'mock',
	modelDisplay: 'Mock',
	cwd: process.cwd(),
	mode: 'bridge',
	sessionId: currentSessionId
});

const rl = createInterface({input: process.stdin});
rl.on('line', line => {
	try {
		const cmd = JSON.parse(line);
		if (cmd.type === 'Heartbeat') {
			emit({type: 'Heartbeat', sessionId: currentSessionId, clientId: cmd.clientId, atMillis: Date.now()});
			return;
		}
		if (cmd.type === 'command' && (cmd.name === 'new' || cmd.name === 'reset')) {
			currentSessionId = randomUUID();
			knownSessions.add(currentSessionId);
			emit({type: 'session_restored', sessionId: currentSessionId, turns: []});
			emit({
				type: 'ready',
				protocolVersion: 2,
				cwd: process.cwd(),
				mode: 'bridge',
				sessionId: currentSessionId,
				sessionTitle: cmd.args || 'New task'
			});
			emit({type: 'command_result', name: 'new', message: `Started session ${currentSessionId.slice(0, 8)}.`, status: 'success'});
			return;
		}
		if (cmd.type === 'AttachSession') {
			if (knownSessions.has(cmd.sessionId)) currentSessionId = cmd.sessionId;
			emit({
				type: 'Attached',
				sessionId: currentSessionId,
				clientId: cmd.clientId,
				lastEventSeq: cmd.lastEventSeq ?? 0
			});
			return;
		}
		if (cmd.type === 'Ack') return;

		if (cmd.type === 'DecideApproval') {
			emit({type: 'approval_resolved', runId: cmd.runId, id: cmd.approvalId, approved: cmd.approved});
			if (cmd.approved) {
				emit({type: 'assistant_delta', turnId: currentRunId, text: ' Approved and continuing.'});
				emit({type: 'final_answer', turnId: currentRunId, text: 'Approved and continuing.'});
				emit({type: 'turn_finished', turnId: currentRunId, success: true});
				emit({type: 'run_done', runId: cmd.runId, success: true, summary: 'done'});
			} else {
				emit({type: 'run_cancelled', runId: cmd.runId, reason: 'approval denied'});
				emit({type: 'turn_finished', turnId: currentRunId, success: false});
			}
			currentRunId = null;
			return;
		}

		if (cmd.type === 'AnswerQuestion') {
			emit({
				type: 'question_answered',
				runId: cmd.runId,
				id: cmd.questionId,
				customText: cmd.answer
			});
			emit({type: 'assistant_delta', turnId: currentRunId, text: ` Answered: ${cmd.answer}`});
			emit({type: 'final_answer', turnId: currentRunId, text: `Answered: ${cmd.answer}`});
			emit({type: 'turn_finished', turnId: currentRunId, success: true});
			emit({type: 'run_done', runId: cmd.runId, success: true, summary: 'answered'});
			currentRunId = null;
			return;
		}

		if (cmd.type === 'CancelRun' || cmd.type === 'CancelSession') {
			const runId = cmd.runId ?? currentRunId ?? 'unknown';
			emit({type: 'run_cancelled', runId, reason: cmd.reason ?? 'cancelled', sessionId: currentSessionId});
			if (currentRunId) emit({type: 'turn_finished', turnId: currentRunId, success: false, sessionId: currentSessionId});
			currentRunId = null;
			heldTurn = null;
			return;
		}

		if (cmd.type === 'InterruptWithMessage') {
			if (cmd.sessionId !== currentSessionId) {
				emit({type: 'error', message: `Session mismatch: ${cmd.sessionId}`});
				return;
			}
			if (heldTurn) {
				emit({type: 'run_cancelled', runId: heldTurn.runId, reason: 'interrupted', sessionId: currentSessionId});
				emit({type: 'turn_finished', turnId: heldTurn.turnId, success: false, sessionId: currentSessionId});
				heldTurn = null;
			}
			followUps.length = 0;
			emitFollowUpChanged();
			emit({type: 'command_result', name: 'InterruptWithMessage', message: 'interrupt_started', status: 'accepted'});
			runTurn(cmd.text, cmd.clientMessageId, {ack: false});
			return;
		}

		if (cmd.type === 'RegisterWorkspace') {
			const hash = projectHash(cmd.path);
			const store = reviewStores.get(hash) ?? buildReviewStore(hash);
			store.path = cmd.path;
			emit({
				type: 'command_result',
				name: 'RegisterWorkspace',
				status: 'accepted',
				message: hash,
				pathHash: hash,
				workspaceId: `workspace:${hash}`
			});
			return;
		}

		if (cmd.type === 'CreateProject') {
			const hash = projectHash(cmd.rootPath);
			const store = reviewStores.get(hash) ?? buildReviewStore(hash);
			store.path = cmd.rootPath;
			emit({
				type: 'command_result',
				name: 'CreateProject',
				status: 'accepted',
				message: 'mock project created',
				projectId: `mock-proj-${hash}`,
				workspaceId: `workspace:${hash}`,
				pathHash: hash
			});
			return;
		}

		if (cmd.type === 'GetWorkspaceMeta') {
			const projects = [...reviewStores.values()].map(store => ({
				id: `mock-proj-${store.pathHash}`,
				isDefault: false,
				workspace: {rootPath: store.path ?? `/tmp/mock-${store.pathHash}`}
			}));
			emit({type: 'workspace_meta', projects});
			emit({type: 'command_result', name: 'GetWorkspaceMeta', status: 'success', message: 'ok'});
			return;
		}

		if (cmd.type === 'ListReviewChanges') {
			const store = reviewStoreFor(cmd);
			emit({
				type: 'command_result',
				name: 'ListReviewChanges',
				status: 'success',
				message: 'ok',
				pathHash: store.pathHash,
				review: reviewPayload(store)
			});
			return;
		}

		if (cmd.type === 'GetReviewChange') {
			const store = reviewStoreFor(cmd);
			const change = store.changes.find(c => c.id === cmd.changeId);
			if (!change) {
				emit({type: 'command_result', name: 'GetReviewChange', status: 'error', message: 'unknown change', pathHash: store.pathHash});
				return;
			}
			emit({type: 'command_result', name: 'GetReviewChange', status: 'success', message: 'ok', pathHash: store.pathHash, review: {change}});
			return;
		}

		if (cmd.type === 'KeepChanges') {
			const store = reviewStoreFor(cmd);
			const ids = new Set(cmd.changeIds ?? []);
			for (const change of store.changes) {
				if (ids.has(change.id) && change.state.kind === 'pending') change.state = {kind: 'kept'};
			}
			store.revision += 1;
			const review = reviewPayload(store);
			emit({type: 'command_result', name: 'KeepChanges', status: 'success', message: 'ok', pathHash: store.pathHash, review});
			emit({type: 'review_changed', pathHash: store.pathHash, review, revision: store.revision, sessionId: currentSessionId});
			return;
		}

		if (cmd.type === 'PreviewRevert') {
			const store = reviewStoreFor(cmd);
			store.seq += 1;
			const targetKind = cmd.target ?? 'whole';
			const selected = store.changes.filter(
				c => c.state.kind === 'pending' && (targetKind !== 'changes' || (cmd.changeIds ?? []).includes(c.id))
			);
			const preview = {
				id: `pv-${store.seq}`,
				target: {kind: targetKind, checkpointId: cmd.checkpointId, changeIds: cmd.changeIds},
				revision: store.revision,
				changes: selected.map(c => ({path: c.path, kind: c.kind, previousPath: c.kind === 'renamed' ? c.before?.path : undefined})),
				conflicts: [],
				excludedPaths: selected.filter(c => c.current?.omitted).map(c => c.path),
				forcePaths: [],
				mergedPaths: []
			};
			store.previews.set(preview.id, preview);
			emit({type: 'command_result', name: 'PreviewRevert', status: 'success', message: 'ok', pathHash: store.pathHash, review: {preview}});
			return;
		}

		if (cmd.type === 'ApplyRevert') {
			const store = reviewStoreFor(cmd);
			const preview = store.previews.get(cmd.previewId);
			if (!preview) {
				emit({type: 'command_result', name: 'ApplyRevert', status: 'error', message: 'unknown preview', pathHash: store.pathHash});
				return;
			}
			const pendingIds = new Set(preview.changes.map(c => c.path));
			for (const change of store.changes) {
				if (pendingIds.has(change.path) && change.state.kind === 'pending') change.state = {kind: 'reverted'};
			}
			store.revision += 1;
			store.seq += 1;
			const restored = {
				restoreId: `rs-${store.seq}`,
				fromTree: `tree-${store.revision - 1}`,
				toTree: `tree-${store.revision}`,
				revision: store.revision
			};
			store.restores.set(restored.restoreId, restored);
			const review = reviewPayload(store);
			emit({type: 'command_result', name: 'ApplyRevert', status: 'success', message: 'ok', pathHash: store.pathHash, review: {restored}});
			emit({type: 'review_changed', pathHash: store.pathHash, review, revision: store.revision, sessionId: currentSessionId});
			emit({type: 'tree_advanced', pathHash: store.pathHash, fromTree: restored.fromTree, toTree: restored.toTree, cause: 'restore', restoreId: restored.restoreId});
			return;
		}

		if (cmd.type === 'RedoRevert') {
			const store = reviewStoreFor(cmd);
			const base = store.restores.get(cmd.restoreId);
			if (!base) {
				emit({type: 'command_result', name: 'RedoRevert', status: 'error', message: 'unknown restore', pathHash: store.pathHash});
				return;
			}
			for (const change of store.changes) {
				if (change.state.kind === 'reverted') change.state = {kind: 'pending'};
			}
			store.revision += 1;
			store.seq += 1;
			const restored = {
				restoreId: `rs-${store.seq}`,
				fromTree: base.toTree,
				toTree: `tree-${store.revision}`,
				revision: store.revision
			};
			store.restores.set(restored.restoreId, restored);
			const review = reviewPayload(store);
			emit({type: 'command_result', name: 'RedoRevert', status: 'success', message: 'ok', pathHash: store.pathHash, review: {restored}});
			emit({type: 'review_changed', pathHash: store.pathHash, review, revision: store.revision, sessionId: currentSessionId});
			emit({type: 'tree_advanced', pathHash: store.pathHash, fromTree: restored.fromTree, toTree: restored.toTree, cause: 'restore', restoreId: restored.restoreId});
			return;
		}

		if (cmd.type === 'RerunRun') {
			if (cmd.sessionId !== currentSessionId) {
				emit({type: 'error', message: `Session mismatch: ${cmd.sessionId}`});
				return;
			}
			const rejectDetail = process.env.FAST_MOCK_RERUN_REJECT;
			if (rejectDetail) {
				emit({
					type: 'command_result',
					name: 'RerunRun',
					status: 'rejected',
					message: rejectDetail,
					sessionId: currentSessionId
				});
				return;
			}
			const origin = turnsByRun.get(cmd.runId) ?? {text: 'rerun', failed: true};
			turnCounter += 1;
			const newRunId = `run_${turnCounter}`;
			emit({
				type: 'command_result',
				name: 'RerunRun',
				status: 'accepted',
				message: `run=${newRunId} supersedes=${cmd.runId}`,
				sessionId: currentSessionId
			});
			runTurn(origin.text, undefined, {supersedes: cmd.runId, supersedesFailed: origin.failed});
			return;
		}

		if (cmd.type === 'SubmitUserMessage') {
			if (cmd.sessionId !== currentSessionId) {
				emit({type: 'error', message: `Session mismatch: ${cmd.sessionId}`});
				return;
			}
			if (heldTurn) {
				const itemId = `fu_${followUps.length + 1}`;
				followUps.push({id: itemId, text: cmd.text, order: followUps.length});
				emit({
					type: 'command_result',
					name: 'SubmitUserMessage',
					message: `followUpId=${itemId}`,
					status: 'queued'
				});
				emitFollowUpChanged();
				return;
			}
			runTurn(cmd.text, cmd.clientMessageId);
		}
	} catch {
		// ignore
	}
});
