import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import {classifyProbeError} from './probe.js';
import {
	displayFingerprint,
	fingerprintOf,
	inspectTls,
	normalizeFingerprint,
	tryNormalizeFingerprint
} from './tlsPin.js';

const HEX = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

test('normalizeFingerprint accepts sha256, colons, and mixed case', () => {
	assert.equal(normalizeFingerprint(`sha256:${HEX}`), `sha256:${HEX}`);
	assert.equal(normalizeFingerprint(`SHA256:${HEX.toUpperCase()}`), `sha256:${HEX}`);
	const colon = HEX.toUpperCase().match(/.{2}/g)!.join(':');
	assert.equal(normalizeFingerprint(colon), `sha256:${HEX}`);
});

test('normalizeFingerprint rejects the wrong length', () => {
	assert.throws(() => normalizeFingerprint('sha256:abcd'), /Invalid certificate fingerprint/);
	assert.equal(tryNormalizeFingerprint('nope'), undefined);
});

test('displayFingerprint is colon-separated uppercase', () => {
	assert.equal(
		displayFingerprint(`sha256:${HEX}`),
		HEX.toUpperCase().match(/.{2}/g)!.join(':')
	);
});

test('fingerprintOf is sha256 of the DER bytes', () => {
	const der = Buffer.from('hello');
	assert.equal(
		fingerprintOf(der),
		'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
	);
});

test('inspectTls against plaintext HTTP is WRONG_VERSION_NUMBER, classified as plaintext', async () => {
	const server = net.createServer(sock => {
		sock.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as net.AddressInfo).port;
	try {
		await assert.rejects(() => inspectTls(`wss://127.0.0.1:${port}/bridge`, 800), err => {
			const message = err instanceof Error ? err.message : String(err);
			assert.match(message, /wrong version number/i);
			assert.equal(classifyProbeError(err).code, 'plaintext');
			return true;
		});
	} finally {
		server.close();
	}
});
