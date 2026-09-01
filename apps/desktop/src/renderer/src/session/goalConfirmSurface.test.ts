import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const dir = dirname(fileURLToPath(import.meta.url));

test('awaiting_confirm is chat history — GoalCardPanel is not the confirm gate', () => {
	const pane = readFileSync(join(dir, 'SessionPane.tsx'), 'utf8');
	assert.equal(
		pane.includes('GoalCardPanel'),
		false,
		'confirm is ordinary chat; SessionPane must not mount the Goal card as a gate'
	);
});

test('awaiting_confirm does not light composer Stop (unconfirmed plan is not a running Goal)', () => {
	const pane = readFileSync(join(dir, 'SessionPane.tsx'), 'utf8');
	assert.equal(
		/STOPPABLE_GOAL_PHASES = new Set\(\[[^\]]*awaiting_confirm/.test(pane),
		false,
		'Stop/run chrome must stay off until the user confirms in chat and start actually runs'
	);
});

test('timeout retry is ErrorCard; regenerate click is not a silent no-op', () => {
	const pane = readFileSync(join(dir, 'SessionPane.tsx'), 'utf8');
	assert.equal(
		pane.includes('regenUserIdOf'),
		true,
		'user-bubble regenerate must use regenUserIdOf so a failed turn never lights the chip'
	);
	assert.equal(
		/if\s*\(\s*gate\.canCancel\s*\)\s*return/.test(pane),
		false,
		'onRegenerate must not silently return while canCancel is true'
	);
	assert.equal(
		/const onRerun = useCallback\([\s\S]*?setRegenPending/.test(pane),
		true,
		'error-card Retry must set regenPending so the click is visible'
	);
	assert.equal(
		pane.includes('retryBusy={Boolean(activeRegen)}'),
		true,
		'error-card Retry busy is in-flight rerun, not composer canCancel'
	);
	assert.equal(
		pane.includes('rerunRun(runId).then'),
		true,
		'rerunRun false/reject must surface a banner, not void-drop'
	);
	assert.equal(
		pane.includes("code: 'send.session_not_ready'"),
		true,
		'session-not-ready from rerun must show the existing send banner'
	);
});

test('awaiting_confirm still paints the drawer Goal row (status chrome, not the chat confirm gate)', () => {
	const drawer = readFileSync(join(dir, 'BackgroundTools.tsx'), 'utf8');
	assert.equal(
		/GOAL_DRAWER_PHASES = new Set\(\[[^\]]*awaiting_confirm/.test(drawer),
		true,
		'drawer Goal card stays visible while awaiting chat confirm'
	);
});
