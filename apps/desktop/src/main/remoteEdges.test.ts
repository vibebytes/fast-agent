import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	commitActiveId,
	deleteServer,
	edgeCapabilities,
	edgeUrl,
	emptyEdgesFile,
	loadEdgesFile,
	LOCAL_EDGE_ID,
	openToken,
	parseEdgesFile,
	remoteConnection,
	sealToken,
	upsertServer,
	validateEdgeInput,
	type TokenVault
} from './remoteEdges.js';

const vault: TokenVault = {
	isEncryptionAvailable: () => true,
	encryptString: plain => Buffer.from(`enc:${plain}`),
	decryptString: buf => buf.toString('utf8').slice(4)
};

test('edgeUrl is wss for remote and ws for loopback', () => {
	assert.equal(edgeUrl('10.0.0.2', 1979), 'wss://10.0.0.2:1979/bridge');
	assert.equal(edgeUrl('127.0.0.1', 1979), 'ws://127.0.0.1:1979/bridge');
	assert.equal(edgeUrl('localhost', 1979), 'ws://localhost:1979/bridge');
});

test('validateEdgeInput rejects empty and IPv6', () => {
	assert.equal(validateEdgeInput({name: '', ip: 'a.com', port: 1, token: 't'}).ok, false);
	assert.equal(validateEdgeInput({name: 's', ip: '', port: 1, token: 't'}).ok, false);
	assert.equal(validateEdgeInput({name: 's', ip: '::1', port: 1, token: 't'}).ok, false);
	assert.equal(validateEdgeInput({name: 's', ip: '1.2.3.4', port: 0, token: 't'}).ok, false);
	assert.equal(validateEdgeInput({name: 's', ip: '1.2.3.4', port: 80, token: ''}).ok, false);
	assert.equal(validateEdgeInput({name: 'lab', ip: '10.0.0.1', port: 1980, token: 'tok'}).ok, true);
	assert.equal(validateEdgeInput({name: 'lab', ip: 'edge.local', port: 1980, token: 'tok'}).ok, true);
	assert.equal(
		validateEdgeInput({name: 'lab', ip: '10.0.0.1', port: 1980, token: 'tok', fingerprint: 'nope'}).ok,
		false
	);
	assert.equal(
		validateEdgeInput({
			name: 'lab',
			ip: '10.0.0.1',
			port: 1980,
			token: 'tok',
			fingerprint: `sha256:${'ab'.repeat(32)}`
		}).ok,
		true
	);
});

test('parseEdgesFile recovers from junk and unknown activeId', () => {
	assert.deepEqual(parseEdgesFile(null), emptyEdgesFile());
	const parsed = parseEdgesFile({
		version: 1,
		activeId: 'missing',
		servers: [{id: 'a', name: 'A', ip: '1.1.1.1', port: 9, token: {plain: 'x'}}]
	});
	assert.equal(parsed.activeId, LOCAL_EDGE_ID);
	assert.equal(parsed.servers.length, 1);
});

test('seal/open token round-trips through vault', () => {
	const sealed = sealToken('secret', vault);
	assert.ok('enc' in sealed);
	assert.equal(openToken(sealed, vault), 'secret');
	assert.deepEqual(sealToken('plain'), {plain: 'plain'});
	assert.equal(openToken({plain: 'p'}), 'p');
});

test('upsert and delete keep local out of servers', () => {
	let file = emptyEdgesFile();
	const one = upsertServer(file, {name: 'lab', ip: '10.0.0.1', port: 1980, token: 'tok'}, vault);
	file = one.file;
	assert.equal(file.servers.length, 1);
	assert.equal(file.activeId, LOCAL_EDGE_ID);
	file = commitActiveId(file, one.id);
	assert.equal(file.activeId, one.id);
	file = deleteServer(file, one.id);
	assert.equal(file.servers.length, 0);
	assert.equal(file.activeId, LOCAL_EDGE_ID);
});

test('caPem is dropped when skip-verify is set', () => {
	const {file} = upsertServer(emptyEdgesFile(), {
		name: 'lab',
		ip: '10.0.0.1',
		port: 1980,
		token: 'tok',
		caPem: '-----BEGIN CERTIFICATE-----\nA\n-----END CERTIFICATE-----',
		insecureSkipVerify: true
	});
	assert.equal(file.servers[0]?.caPem, undefined);
	assert.equal(file.servers[0]?.insecureSkipVerify, true);
});

test('capabilities flip with remote and pending', () => {
	assert.deepEqual(edgeCapabilities('local'), {
		canOpenLocalFolder: true,
		canCreateLocalProject: true,
		canOpenRemoteFolder: false
	});
	assert.deepEqual(edgeCapabilities('abc'), {
		canOpenLocalFolder: false,
		canCreateLocalProject: false,
		canOpenRemoteFolder: true
	});
	assert.equal(edgeCapabilities('abc', 'abc').canOpenRemoteFolder, false);
});

test('loadEdgesFile treats missing as empty and logs corrupt JSON', () => {
	const dir = mkdtempSync(join(tmpdir(), 'edges-load-'));
	assert.deepEqual(loadEdgesFile(join(dir, 'missing.json')), emptyEdgesFile());
	const bad = join(dir, 'remote-edges.json');
	writeFileSync(bad, '{not-json');
	assert.deepEqual(loadEdgesFile(bad), emptyEdgesFile());
});

test('remoteConnection builds wss options from a stored row', () => {
	const pin = `sha256:${'ab'.repeat(32)}`;
	const opts = remoteConnection(
		{ip: '10.0.0.2', port: 1979, token: {plain: 'tok'}, fingerprint: pin, caPem: 'PEM'},
		vault
	);
	assert.equal(opts.url, 'wss://10.0.0.2:1979/bridge');
	assert.equal(opts.authToken, 'tok');
	assert.equal(opts.fingerprint, pin);
	assert.equal(opts.caPem, 'PEM');
	assert.equal(opts.timeoutMs, 8_000);
});

test('upsert persists a normalized fingerprint', () => {
	const raw = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
	const {file} = upsertServer(emptyEdgesFile(), {
		name: 'lab',
		ip: '10.0.0.1',
		port: 1980,
		token: 'tok',
		fingerprint: raw
	});
	assert.equal(file.servers[0]?.fingerprint, `sha256:${raw.replace(/:/g, '').toLowerCase()}`);
});
