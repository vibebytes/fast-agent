import test from 'node:test';
import assert from 'node:assert/strict';
import {createComposerSend, type ComposerTaskLike} from './composerSend.js';

test('submitUserText forwards images onto SubmitUserMessage', () => {
	const sent: unknown[] = [];
	const task: ComposerTaskLike = {
		id: 't1',
		sessionId: 's1',
		autoTitlePending: false,
		model: null,
		modelDisplay: null
	};
	const composer = createComposerSend({
		createId: () => 'cid',
		now: () => 0,
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		getActiveTask: () => task,
		commandSessionId: () => 's1',
		canSubmitNow: () => true,
		canSubmitCommand: () => true,
		describeSendBlocker: () => '',
		engineKind: () => 'fast' as const,
		promptLine: (n, a) => `/${n} ${a ?? ''}`.trim(),
		selectModel: () => true,
		requestModelList: () => true,
		setHelpNotice: () => {},
		applyRunMode: () => {},
		effort: () => undefined,
		onClearSlash: () => true,
		touchLastModified: () => {},
		useModelOf: () => undefined,
		catalogHas: () => false,
		submitThinking: () => undefined,
		titleGenRequested: new Set(),
		seedHostSlashCatalog: () => true,
		slashCatalogLive: () => true,
		applyEmptySlashCatalog: () => {},
		markSlashCatalogHydrated: () => {},
		appendSkillsTranscript: () => {}
	});

	const images = [{mediaType: 'image/png', data: 'YWJj', name: 'a.png'}];
	assert.equal(composer.submitUserText('what is this', undefined, undefined, images), true);
	assert.equal(sent.length, 1);
	const cmd = sent[0] as {type: string; text: string; images?: typeof images};
	assert.equal(cmd.type, 'SubmitUserMessage');
	assert.equal(cmd.text, 'what is this');
	assert.deepEqual(cmd.images, images);
});

test('submitUserText allows images-only (empty text)', () => {
	const sent: unknown[] = [];
	const task: ComposerTaskLike = {
		id: 't1',
		sessionId: 's1',
		autoTitlePending: false,
		model: null,
		modelDisplay: null
	};
	const composer = createComposerSend({
		createId: () => 'cid',
		now: () => 0,
		send: cmd => {
			sent.push(cmd);
			return true;
		},
		getActiveTask: () => task,
		commandSessionId: () => 's1',
		canSubmitNow: () => true,
		canSubmitCommand: () => true,
		describeSendBlocker: () => '',
		engineKind: () => 'fast' as const,
		promptLine: (n, a) => `/${n} ${a ?? ''}`.trim(),
		selectModel: () => true,
		requestModelList: () => true,
		setHelpNotice: () => {},
		applyRunMode: () => {},
		effort: () => undefined,
		onClearSlash: () => true,
		touchLastModified: () => {},
		useModelOf: () => undefined,
		catalogHas: () => false,
		submitThinking: () => undefined,
		titleGenRequested: new Set(),
		seedHostSlashCatalog: () => true,
		slashCatalogLive: () => true,
		applyEmptySlashCatalog: () => {},
		markSlashCatalogHydrated: () => {},
		appendSkillsTranscript: () => {}
	});

	assert.equal(
		composer.submitUserText('', undefined, undefined, [
			{mediaType: 'image/png', data: 'YWJj', name: 'shot.png'}
		]),
		true
	);
	const cmd = sent[0] as {text: string; images: unknown[]};
	assert.equal(cmd.text, '');
	assert.equal(cmd.images.length, 1);
});
