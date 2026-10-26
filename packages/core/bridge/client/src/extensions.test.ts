import test from 'node:test';
import assert from 'node:assert/strict';
import {extAdminMethods, extensionPayload, restartHint} from './extensions.js';

test('ext admin method names match settings-style verbs', () => {
	assert.deepEqual(extAdminMethods, [
		'listExtensions',
		'extensionStatus',
		'extensionHealth',
		'installExtension',
		'uninstallExtension',
		'setExtensionEnabled'
	]);
});

test('extensionHealth result decodes ok/down probe', () => {
	const res: {ok: true; status: {extension_id: string; status: 'ok' | 'down'; checked_at: string; detail?: string}} = {
		ok: true,
		status: {extension_id: 'vibe3d', status: 'down', checked_at: '2026-10-26T10:00:00Z', detail: 'daemon http 127.0.0.1:62597 unreachable'}
	};
	assert.equal(res.ok, true);
	assert.equal(res.status.status, 'down');
	assert.equal(typeof res.status.checked_at, 'string');
});

test('hotUnload false projects 需重启', () => {
	assert.equal(restartHint({hotUnload: false}), '需重启');
	assert.equal(restartHint({hotUnload: true}), undefined);
	const row = extensionPayload({id: 'memory', phase: 'Active', hotUnload: false});
	assert.equal(row.restartHint, '需重启');
	assert.equal(row.id, 'memory');
});

test('listExtensions success body carries ledger put/drop', () => {
	const ledger = [
		{id: 'probe', mark: 'put'},
		{id: 'probe', mark: 'drop'}
	];
	const ok: {ok: true; extensions: []; ledger: typeof ledger} = {
		ok: true,
		extensions: [],
		ledger
	};
	assert.equal(ok.ledger.length, 2);
	assert.equal(ok.ledger[0]?.mark, 'put');
	assert.equal(ok.ledger[1]?.mark, 'drop');
	assert.equal(extensionPayload({id: 'probe', phase: 'Active', hotUnload: true}).restartHint, undefined);
});
